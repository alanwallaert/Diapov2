const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const JSZip = require('jszip');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DB_FILE = './database.json';
const USERS_FILE = './users.json';

// --- CONFIGURATION PAR DÉFAUT ---
let approvedPhotos = []; 
let rejectedPhotos = []; 
let trashedPhotos = [];
let autoApprove = false;
let slideDuration = 7000;
let eventCode = "1234"; 
let isEventActive = true; 
let activeClients = {};

// Chargement DB
if (fs.existsSync(DB_FILE)) {
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE));
        approvedPhotos = data.approved || [];
        rejectedPhotos = data.rejected || [];
        trashedPhotos = data.trashed || [];
        autoApprove = data.autoApprove || false;
        slideDuration = data.slideDuration || 7000;
        eventCode = data.eventCode || "1234";
        isEventActive = data.isEventActive !== undefined ? data.isEventActive : true;
    } catch(e) { console.log("Erreur lecture DB"); }
}

function saveDB() {
    const data = { approved: approvedPhotos, rejected: rejectedPhotos, trashed: trashedPhotos, autoApprove, slideDuration, eventCode, isEventActive };
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

const publicPath = path.join(__dirname, 'public');
const uploadPath = path.join(publicPath, 'uploads');
[publicPath, uploadPath].forEach(dir => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); });

app.use(session({ secret: 'prestation-top-secret', resave: false, saveUninitialized: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(publicPath));

app.get('/manifest.json', (req, res) => { res.sendFile(path.join(__dirname, 'manifest.json')); });

const storage = multer.diskStorage({
    destination: uploadPath,
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

function refreshAll() {
    saveDB();
    let stats = { home: [], gallery: [], retro: [] };
    Object.values(activeClients).forEach(c => { if (stats[c.page]) stats[c.page].push(c.name); });
    io.emit('init_photos', { photos: approvedPhotos, duration: slideDuration });
    io.emit('init_admin', { approved: approvedPhotos, rejected: rejectedPhotos, trashed: trashedPhotos, autoApprove, slideDuration, eventCode, isEventActive, stats: stats });
}

io.on('connection', (socket) => {
    const { page, name } = socket.handshake.query;
    if (page && page !== 'admin') activeClients[socket.id] = { name: name || "Anonyme", page: page };
    refreshAll();
    socket.on('disconnect', () => { delete activeClients[socket.id]; refreshAll(); });
});

// --- PROTECTION INVITÉS ---
const checkEventAccess = (req, res, next) => {
    if (!isEventActive) return res.send(`<body style="background:#121212;color:white;text-align:center;padding:50px;font-family:sans-serif;"><h1>🔒 Prestation terminée</h1><p>L'accès est fermé.</p></body>`);
    if (req.session.hasAccess) return next();
    res.send(`
        <body style="background:#121212;color:white;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;">
            <div style="background:#1e1e1e;padding:40px;border-radius:20px;text-align:center;width:300px;box-shadow:0 10px 30px rgba(0,0,0,0.5);">
                <h2 style="color:#28a745;">Code d'accès</h2>
                <input type="text" id="c" placeholder="CODE ICI" style="width:100%;padding:15px;margin-bottom:20px;border-radius:10px;border:none;background:#333;color:white;text-align:center;font-size:24px;font-weight:bold;letter-spacing:3px;">
                <button onclick="check()" style="width:100%;padding:15px;background:#28a745;color:white;border:none;border-radius:10px;font-weight:bold;cursor:pointer;font-size:18px;">ENTRER</button>
            </div>
            <script>
                async function check() {
                    const code = document.getElementById('c').value;
                    const res = await fetch('/verify-code', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({code}) });
                    if(res.ok) location.reload(); else alert("Code incorrect !");
                }
            </script>
        </body>
    `);
};

app.post('/verify-code', (req, res) => {
    if (req.body.code === eventCode) { req.session.hasAccess = true; res.sendStatus(200); }
    else res.sendStatus(403);
});

// --- ROUTES ---

app.get('/', checkEventAccess, (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="fr">
        <head>
            <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link rel="manifest" href="/manifest.json"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="theme-color" content="#28a745">
            <title>Prestation</title>
        </head>
        <body style="font-family:sans-serif; text-align:center; background:#121212; color:white; padding:20px; margin:0;">
            <div style="background:#1e1e1e; padding:25px; border-radius:20px; max-width:400px; margin:auto;">
                <h2 style="margin-bottom:25px;">📸 Prestation</h2>
                <input type="text" id="user" oninput="localStorage.setItem('p_name', this.value)" placeholder="Votre Prénom" style="width:100%; padding:15px; margin-bottom:20px; border-radius:10px; border:none; background:#333; color:white; font-size:16px;">
                <div style="display:flex; flex-direction:column; gap:15px;">
                    <label style="background:#007bff; padding:20px; border-radius:15px; cursor:pointer; font-weight:bold;">
                        <input type="file" id="file_cam" accept="image/*" capture="camera" style="display:none;" onchange="handleFile(this, '📸 PHOTO PRÊTE')">
                        <span>📷 PRENDRE UNE PHOTO</span>
                    </label>
                    <label style="background:#444; padding:20px; border-radius:15px; cursor:pointer; font-weight:bold;">
                        <input type="file" id="file_album" accept="image/*" style="display:none;" onchange="handleFile(this, '🖼️ IMAGE CHOISIE')">
                        <span>📁 CHOISIR UN FICHIER</span>
                    </label>
                </div>
                <button id="sendBtn" onclick="send()" style="width:100%; padding:20px; background:#28a745; color:white; border:none; border-radius:12px; margin-top:30px; cursor:pointer; font-weight:bold; font-size:18px;">ENVOYER</button>
                <button onclick="location.href='/gallery'" style="width:100%; padding:15px; background:transparent; color:#007bff; border:2px solid #007bff; border-radius:12px; margin-top:15px; cursor:pointer; font-weight:bold;">🖼️ VOIR LES PHOTOS</button>
            </div>
            <script src="/socket.io/socket.io.js"></script>
            <script>
                const socket = io({ query: { page: 'home', name: localStorage.getItem('p_name') || 'Anonyme' } });
                document.getElementById('user').value = localStorage.getItem('p_name') || "";
                function handleFile(input, text) { input.parentElement.querySelector('span').innerText = text; }
                async function send() {
                    const file = document.getElementById('file_cam').files[0] || document.getElementById('file_album').files[0];
                    const user = document.getElementById('user').value;
                    if(!file || !user) return alert("Nom + Photo !");
                    const fd = new FormData(); fd.append('photo', file); fd.append('username', user);
                    await fetch('/upload', { method:'POST', body:fd });
                    alert("Envoyé !"); location.reload();
                }
            </script>
        </body>
        </html>
    `);
});

// Admin Login
app.get('/login', (req, res) => {
    res.send('<body style="background:#121212;color:white;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;font-family:sans-serif;"><form action="/login" method="POST" style="background:#1e1e1e;padding:30px;border-radius:15px;text-align:center;"><h2 style="margin-top:0;">Admin</h2><input type="password" name="password" placeholder="Pass Admin" style="padding:15px;border-radius:8px;border:none;width:200px;font-size:16px;"><button type="submit" style="padding:15px;margin-left:10px;background:#28a745;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:bold;">OK</button></form></body>');
});

app.post('/login', (req, res) => {
    if (req.body.password === "1234") { req.session.admin = true; res.redirect('/admin'); }
    else res.send("<script>alert('Erreur'); window.location='/login';</script>");
});

// --- PAGE ADMIN COMPLÈTE ---
app.get('/admin', (req, res) => {
    if (!req.session.admin) return res.redirect('/login');
    res.send(`
        <body style="font-family:sans-serif; background:#f0f2f5; margin:0; padding:15px;">
            <div style="background:white; padding:15px; border-radius:15px; display:flex; justify-content:space-between; align-items:center; box-shadow:0 2px 10px rgba(0,0,0,0.1); margin-bottom:15px;">
                <h1 style="margin:0; font-size:18px;">🛡 Admin Prestation</h1>
                <div style="display:flex; gap:10px;">
                    <button onclick="location.href='/retro'" style="padding:8px; background:#6f42c1; color:white; border:none; border-radius:5px; cursor:pointer;">📽 DIAPO</button>
                    <a href="/logout" style="text-decoration:none; color:white; background:#dc3545; padding:8px; border-radius:5px;">X</a>
                </div>
            </div>

            <div style="background:white; padding:15px; border-radius:15px; margin-bottom:15px; box-shadow:0 2px 5px rgba(0,0,0,0.05);">
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                    <div style="border:1px solid #ddd; padding:10px; border-radius:8px;">
                        <span style="font-size:12px; font-weight:bold; color:#666;">CODE INVITÉS</span><br>
                        <input type="text" id="newCode" value="${eventCode}" style="width:70px; padding:5px; margin-top:5px;">
                        <button onclick="saveCode()" style="font-size:10px;">OK</button>
                    </div>
                    <div style="border:1px solid #ddd; padding:10px; border-radius:8px; text-align:center;">
                        <span style="font-size:12px; font-weight:bold; color:#666;">ACCÈS</span><br>
                        <button id="statusBtn" onclick="toggleStatus()" style="margin-top:5px; padding:5px 10px; border-radius:5px; border:none; cursor:pointer; font-weight:bold;"></button>
                    </div>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:10px;">
                     <div style="border:1px solid #ddd; padding:10px; border-radius:8px;">
                        <label style="font-size:11px; font-weight:bold;">🚀 AUTO-APPROUVER</label>
                        <input type="checkbox" id="autoCheck" onchange="fetch('/toggle-auto', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({state:this.checked})})">
                    </div>
                    <button onclick="location.href='/admin/download-zip'" style="background:#28a745; color:white; border:none; border-radius:8px; font-weight:bold;">📥 ZIP</button>
                </div>
            </div>

            <div style="display:flex; gap:5px; margin-bottom:15px;">
                <button onclick="showTab('pending')" id="btn-pending" style="flex:1; padding:10px; border:none; border-radius:8px; background:#007bff; color:white;">ATTENTE</button>
                <button onclick="showTab('approved')" id="btn-approved" style="flex:1; padding:10px; border:none; border-radius:8px; background:#ddd;">OUI (<span id="nb-oui">0</span>)</button>
                <button onclick="showTab('trashed')" id="btn-trashed" style="flex:1; padding:10px; border:none; border-radius:8px; background:#ddd;">🗑️</button>
            </div>

            <div id="tab-pending" class="tab-content"><div id="list-pending" style="display:flex; flex-wrap:wrap; gap:10px;"></div></div>
            <div id="tab-approved" class="tab-content" style="display:none;"><div id="list-approved" style="display:flex; flex-wrap:wrap; gap:10px;"></div></div>
            <div id="tab-trashed" class="tab-content" style="display:none;"><div id="list-trashed" style="display:flex; flex-wrap:wrap; gap:10px;"></div></div>

            <script src="/socket.io/socket.io.js"></script>
            <script>
                const socket = io();
                let isActive = ${isEventActive};

                function saveCode() {
                    const c = document.getElementById('newCode').value;
                    fetch('/set-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:c})}).then(()=>alert('Code mis à jour'));
                }

                function toggleStatus() {
                    isActive = !isActive;
                    fetch('/toggle-event', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({state:isActive})});
                    updateBtn();
                }

                function updateBtn() {
                    const btn = document.getElementById('statusBtn');
                    btn.innerText = isActive ? "OUVERT" : "FERMÉ";
                    btn.style.background = isActive ? "#28a745" : "#dc3545";
                    btn.style.color = "white";
                }
                updateBtn();

                function showTab(t) {
                    document.querySelectorAll('.tab-content').forEach(el=>el.style.display='none');
                    document.querySelectorAll('button[id^="btn-"]').forEach(b=>{b.style.background='#ddd'; b.style.color='black';});
                    document.getElementById('tab-'+t).style.display='block';
                    document.getElementById('btn-'+t).style.background = (t==='pending' ? '#007bff' : (t==='approved' ? '#28a745' : 'black'));
                    document.getElementById('btn-'+t).style.color = 'white';
                }

                socket.on('init_admin', d => {
                    document.getElementById('nb-oui').innerText = d.approved.length;
                    document.getElementById('autoCheck').checked = d.autoApprove;
                    ['approved','trashed'].forEach(type => {
                        const l = document.getElementById('list-'+type); l.innerHTML = "";
                        d[type].forEach(p => {
                            const div = document.createElement('div');
                            div.style = "background:white; padding:5px; border-radius:8px; width:90px; text-align:center; box-shadow:0 1px 3px rgba(0,0,0,0.1);";
                            let btn = type==='approved' ? '<button onclick="act(\\'/delete\\',\\''+p.url+'\\')" style="background:black;color:white;width:100%;">🗑️</button>' : '<button onclick="act(\\'/approve\\',\\''+p.url+'\\',\\''+p.user+'\\')" style="background:#28a745;color:white;width:100%;">OUI</button>';
                            div.innerHTML = '<img src="'+p.url+'" style="width:100%; height:60px; object-fit:cover; border-radius:5px;"><div style="margin-top:5px;">'+btn+'</div>';
                            l.appendChild(div);
                        });
                    });
                });

                socket.on('new_photo_pending', p => {
                    const l = document.getElementById('list-pending');
                    const div = document.createElement('div'); div.style = "background:white; padding:10px; border-radius:10px; width:130px; border:2px solid #007bff; text-align:center;";
                    div.innerHTML = '<img src="'+p.url+'" style="width:100%; border-radius:5px;"><p style="font-size:11px;margin:5px 0;">'+p.user+'</p>' +
                    '<button onclick="act(\\'/approve\\',\\''+p.url+'\\',\\''+p.user+'\\'); this.parentElement.remove();" style="background:#28a745;color:white;width:45%;border:none;padding:5px;margin-right:5%;">OUI</button>' +
                    '<button onclick="act(\\'/delete\\',\\''+p.url+'\\'); this.parentElement.remove();" style="background:black;color:white;width:45%;border:none;padding:5px;">🗑️</button>';
                    l.prepend(div);
                });

                function act(r,u,usr) { fetch(r,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:u,user:usr})}); }
            </script>
        </body>
    `);
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// --- ACTIONS ADMIN ---
app.post('/set-code', (req, res) => { if(req.session.admin) { eventCode = req.body.code; refreshAll(); res.sendStatus(200); } });
app.post('/toggle-event', (req, res) => { if(req.session.admin) { isEventActive = req.body.state; refreshAll(); res.sendStatus(200); } });
app.post('/toggle-auto', (req, res) => { if(req.session.admin) { autoApprove = req.body.state; refreshAll(); res.sendStatus(200); } });

app.post('/approve', (req, res) => {
    const p = req.body;
    trashedPhotos = trashedPhotos.filter(x => x.url !== p.url);
    if(!approvedPhotos.some(x => x.url === p.url)) approvedPhotos.push(p);
    refreshAll(); res.sendStatus(200);
});

app.post('/delete', (req, res) => {
    const p = req.body;
    approvedPhotos = approvedPhotos.filter(x => x.url !== p.url);
    if(!trashedPhotos.some(x => x.url === p.url)) trashedPhotos.push(p);
    refreshAll(); res.sendStatus(200);
});

app.get('/admin/download-zip', async (req, res) => {
    if(!req.session.admin) return res.sendStatus(403);
    const zip = new JSZip();
    approvedPhotos.forEach(p => {
        const filePath = path.join(publicPath, p.url);
        if (fs.existsSync(filePath)) zip.file(path.basename(p.url), fs.readFileSync(filePath));
    });
    const content = await zip.generateAsync({ type: "nodebuffer" });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=photos.zip');
    res.send(content);
});

// --- AUTRES PAGES (GALLERY / RETRO) ---

app.get('/gallery', checkEventAccess, (req, res) => {
    res.send(`<body style="background:#121212;color:white;font-family:sans-serif;padding:20px;text-align:center;"><h2>🖼️ Galerie</h2><div id="grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;"></div><button onclick="location.href='/'" style="margin-top:20px;padding:15px;background:#007bff;color:white;border:none;border-radius:10px;font-weight:bold;">RETOUR</button><script src="/socket.io/socket.io.js"></script><script>const socket=io({ query: { page: 'gallery', name: localStorage.getItem('p_name') || 'Anonyme' } });socket.on('init_photos',data=>{const g=document.getElementById('grid');g.innerHTML="";data.photos.forEach(p=>{g.innerHTML+='<img src="'+p.url+'" style="width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:10px;">';});});</script></body>`);
});

app.get('/retro', (req, res) => {
    res.send(`<body style="background:black; color:white; margin:0; overflow:hidden; font-family:sans-serif; text-align:center; cursor: pointer;" onclick="toggleFS()"><div id="start-btn" style="position:fixed; inset:0; background:rgba(0,0,0,0.95); z-index:100; display:flex; flex-direction:column; align-items:center; justify-content:center;"><button onclick="start(event)" style="padding:20px 40px; font-size:22px; border-radius:40px; background:#28a745; color:white; border:none; cursor:pointer; font-weight:bold;">📽️ LANCER LE DIAPORAMA</button></div><div id="main" style="height:100vh; display:flex; align-items:center; justify-content:center; position:relative;"><h1 id="msg">En attente...</h1><img id="img" style="max-width:100%; max-height:100vh; display:none; transition: opacity 1s; object-fit: contain;"><div id="tag" style="position:absolute; bottom:50px; background:rgba(0,0,0,0.7); padding:10px 30px; border-radius:30px; font-size:30px; display:none;"></div><div id="qr-container" style="position:absolute; bottom:20px; right:20px; background:white; padding:10px; border-radius:15px; display:flex; flex-direction:column; align-items:center; box-shadow: 0 0 20px rgba(0,0,0,0.5); z-index:20;"><img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=https://diapov2.onrender.com/" style="width:100px; height:100px;"><span style="color:black; font-size:12px; font-weight:bold; margin-top:5px;">SCANNEZ-MOI !</span></div></div><script src="/socket.io/socket.io.js"></script><script>const socket = io({ query: { page: 'retro', name: 'Écran Diapo' } }); let list = []; let cur = 0; let t = null; let currentDuration = 7000; function toggleFS() { if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(e => {}); } socket.on('init_photos', (data) => { list = data.photos; currentDuration = data.duration; if (t) { clearInterval(t); t = setInterval(loop, currentDuration); } }); function start(e) { e.stopPropagation(); toggleFS(); document.getElementById('start-btn').style.display='none'; if(list.length) loop(); } function loop() { const i = document.getElementById('img'); const tag = document.getElementById('tag'); if(!list.length) return; document.getElementById('msg').style.display='none'; i.style.display='block'; tag.style.display='block'; i.style.opacity = 0; setTimeout(() => { i.src = list[cur].url; tag.innerText = "📸 " + list[cur].user; i.style.opacity = 1; cur = (cur + 1) % list.length; }, 100); if(!t) t = setInterval(loop, currentDuration); }</script></body>`);
});

app.post('/upload', upload.single('photo'), (req, res) => {
    const data = { url: '/uploads/'+req.file.filename, user: req.body.username };
    if (autoApprove) { approvedPhotos.push(data); refreshAll(); }
    else io.emit('new_photo_pending', data);
    res.sendStatus(200);
});

server.listen(PORT, () => { console.log("🚀 Connecté sur le port " + PORT); });
