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

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const USERS_FILE = './users.json';
const DB_FILE = './database.json';

let approvedPhotos = []; 
let rejectedPhotos = []; 
let trashedPhotos = [];
let autoApprove = false;
let slideDuration = 7000;
let eventCode = "1234"; 
let activeClients = {};

// Persistance des données
if (fs.existsSync(DB_FILE)) {
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE));
        approvedPhotos = data.approved || [];
        rejectedPhotos = data.rejected || [];
        trashedPhotos = data.trashed || [];
        autoApprove = data.autoApprove || false;
        slideDuration = data.slideDuration || 7000;
        eventCode = data.eventCode || "1234";
    } catch(e) { console.log("Erreur lecture DB"); }
}

function saveDB() {
    const data = { approved: approvedPhotos, rejected: rejectedPhotos, trashed: trashedPhotos, autoApprove, slideDuration, eventCode };
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

const publicPath = path.join(__dirname, 'public');
const uploadPath = path.join(publicPath, 'uploads');
[publicPath, uploadPath].forEach(dir => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); });

if (!fs.existsSync(USERS_FILE)) {
    const hashed = bcrypt.hashSync("1234", 10);
    fs.writeFileSync(USERS_FILE, JSON.stringify([{ id: "admin", pass: hashed }]));
}

app.use(session({ secret: 'dj-secret-key-123', resave: false, saveUninitialized: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(publicPath));

const storage = multer.diskStorage({
    destination: uploadPath,
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

function refreshAll() {
    saveDB();
    let stats = { home: 0, gallery: 0, retro: 0 };
    Object.values(activeClients).forEach(c => { if (stats[c.page] !== undefined) stats[c.page]++; });
    io.emit('init_photos', { photos: approvedPhotos, duration: slideDuration });
    io.emit('init_admin', { 
        approved: approvedPhotos, rejected: rejectedPhotos, autoApprove, slideDuration, eventCode, stats: stats 
    });
}

io.on('connection', (socket) => {
    const { page, name } = socket.handshake.query;
    activeClients[socket.id] = { name: name || "Anonyme", page: page || 'unknown' };
    refreshAll();
    socket.on('disconnect', () => { delete activeClients[socket.id]; refreshAll(); });
});

const isAdmin = (req, res, next) => { if (req.session.user === 'admin') next(); else res.redirect('/prive-dj'); };
const isPublic = (req, res, next) => { if (req.session.user === 'public' || req.session.user === 'admin') next(); else res.redirect('/'); };

// --- 1. INTERFACE PUBLIC (INVITES) ---
app.get('/', (req, res) => {
    res.send(`
        <body style="font-family:sans-serif; background:#121212; color:white; display:flex; align-items:center; justify-content:center; height:100vh; margin:0;">
            <form action="/login-public" method="POST" style="background:#1e1e1e; padding:30px; border-radius:20px; width:300px; text-align:center;">
                <h2 style="color:#28a745;">Accès Invité</h2>
                <input type="password" name="code" placeholder="Code de la soirée" required style="width:100%; padding:15px; margin:20px 0; border-radius:10px; border:none; background:#333; color:white; text-align:center; font-size:20px;">
                <button type="submit" style="width:100%; padding:15px; background:#28a745; color:white; border:none; border-radius:10px; cursor:pointer; font-weight:bold;">ENTRER</button>
            </form>
        </body>
    `);
});

app.post('/login-public', (req, res) => {
    if (req.body.code === eventCode) { req.session.user = 'public'; res.redirect('/upload-page'); }
    else res.send("<script>alert('Code incorrect'); window.location='/';</script>");
});

app.get('/upload-page', isPublic, (req, res) => {
    res.send(`
        <body style="font-family:sans-serif; text-align:center; background:#121212; color:white; padding:20px;">
            <div style="background:#1e1e1e; padding:25px; border-radius:20px; max-width:400px; margin:auto;">
                <h2>📸 Partagez vos photos</h2>
                <input type="text" id="user" oninput="localStorage.setItem('p_name', this.value)" placeholder="Votre Prénom" style="width:100%; padding:15px; margin-bottom:20px; border-radius:10px; border:none; background:#333; color:white;">
                <input type="file" id="file" accept="image/*" style="display:none;" onchange="send(this)">
                <button onclick="document.getElementById('file').click()" style="width:100%; padding:20px; background:#007bff; color:white; border:none; border-radius:12px; font-weight:bold;">Prendre / Choisir Photo</button>
                <button onclick="location.href='/gallery'" style="width:100%; padding:15px; background:transparent; color:#007bff; border:2px solid #007bff; border-radius:12px; margin-top:15px;">Voir la Galerie</button>
            </div>
            <script>
                document.getElementById('user').value = localStorage.getItem('p_name') || "";
                async function send(input) {
                    const fd = new FormData(); fd.append('photo', input.files[0]); fd.append('username', document.getElementById('user').value);
                    await fetch('/upload', { method:'POST', body:fd });
                    alert("Photo envoyée !"); location.reload();
                }
            </script>
        </body>
    `);
});

// --- 2. INTERFACE DJ (ADMIN) ---
app.get('/prive-dj', (req, res) => {
    res.send(`
        <body style="font-family:sans-serif; background:#000; color:white; display:flex; align-items:center; justify-content:center; height:100vh; margin:0;">
            <form action="/login-admin" method="POST" style="background:#111; padding:40px; border-radius:10px; width:300px; text-align:center; border:2px solid #444;">
                <h2 style="color:#007bff;">🛡 ACCÈS STAFF</h2>
                <input type="text" name="userid" placeholder="Login" required style="width:100%; padding:12px; margin-bottom:15px; border-radius:5px; border:none; background:#222; color:white;">
                <input type="password" name="password" placeholder="Mot de passe" required style="width:100%; padding:12px; margin-bottom:25px; border-radius:5px; border:none; background:#222; color:white;">
                <button type="submit" style="width:100%; padding:15px; background:#007bff; color:white; border:none; border-radius:5px; cursor:pointer;">CONNEXION</button>
            </form>
        </body>
    `);
});

app.post('/login-admin', (req, res) => {
    const users = JSON.parse(fs.readFileSync(USERS_FILE));
    const admin = users.find(u => u.id === 'admin');
    if (req.body.userid === 'admin' && bcrypt.compareSync(req.body.password, admin.pass)) {
        req.session.user = 'admin'; res.redirect('/admin-dashboard');
    } else res.send("<script>alert('Refusé'); window.location='/prive-dj';</script>");
});

app.get('/admin-dashboard', isAdmin, (req, res) => {
    res.send(`
        <body style="font-family:sans-serif; background:#f0f2f5; margin:0; padding:15px;">
            <div style="background:white; padding:15px; border-radius:15px; display:flex; justify-content:space-between; align-items:center; box-shadow:0 2px 10px rgba(0,0,0,0.1); margin-bottom:15px;">
                <h1 style="margin:0; font-size:18px;">🛡 Dashboard DJ</h1>
                <a href="/logout" style="text-decoration:none; color:white; background:#dc3545; padding:8px 15px; border-radius:8px;">X</a>
            </div>

            <div style="display:flex; gap:10px; margin-bottom:15px;">
                <button onclick="showTab('pending')" id="btn-pending" style="flex:1; padding:12px; border:none; border-radius:10px; background:#007bff; color:white; font-weight:bold;">ATTENTE</button>
                <button onclick="showTab('approved')" id="btn-approved" style="flex:1; padding:12px; border:none; border-radius:10px; background:#ddd;">APPROUVÉES</button>
                <button onclick="showTab('security')" id="btn-security" style="flex:1; padding:12px; border:none; border-radius:10px; background:#ddd;">🔐 CODES</button>
            </div>

            <div id="tab-pending" class="tab-content"><div id="list-pending" style="display:flex; flex-wrap:wrap; gap:10px;"></div></div>
            <div id="tab-approved" class="tab-content" style="display:none;"><div id="list-approved" style="display:flex; flex-wrap:wrap; gap:10px;"></div></div>
            
            <div id="tab-security" class="tab-content" style="display:none;">
                <div style="background:white; padding:20px; border-radius:15px; margin-bottom:15px;">
                    <h3>🔑 CODE INVITES</h3>
                    <input type="text" id="newPublicCode" value="${eventCode}" style="padding:10px; width:150px; text-align:center; font-size:18px;">
                    <button onclick="updatePublicCode()" style="padding:10px; background:#28a745; color:white; border:none; border-radius:8px; cursor:pointer;">CHANGER</button>
                </div>
                <div style="background:white; padding:20px; border-radius:15px;">
                    <h3>🛡 MOT DE PASSE STAFF (Login: admin)</h3>
                    <input type="password" id="newAdminPass" placeholder="Nouveau mot de passe" style="padding:10px; width:100%; margin-bottom:10px;">
                    <button onclick="updateAdminPass()" style="width:100%; padding:15px; background:#007bff; color:white; border:none; border-radius:8px; cursor:pointer;">CHANGER LE MDP ADMIN</button>
                </div>
                <button onclick="location.href='/admin/download-zip'" style="width:100%; padding:15px; background:#6f42c1; color:white; border:none; border-radius:10px; font-weight:bold; margin-top:20px; cursor:pointer;">📥 TELECHARGER ZIP DES PHOTOS</button>
            </div>

            <script src="/socket.io/socket.io.js"></script>
            <script>
                const socket = io({ query: { page: 'admin' } });
                function showTab(t) { 
                    document.querySelectorAll('.tab-content').forEach(el=>el.style.display='none');
                    document.querySelectorAll('button[id^="btn-"]').forEach(b=>b.style.background='#ddd');
                    document.getElementById('tab-'+t).style.display='block';
                    document.getElementById('btn-'+t).style.background='#007bff';
                }
                function updatePublicCode() {
                    const code = document.getElementById('newPublicCode').value;
                    fetch('/set-code', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({code})}).then(()=>alert('Code Public modifié !'));
                }
                function updateAdminPass() {
                    const pass = document.getElementById('newAdminPass').value;
                    if(!pass) return alert('Entrez un mot de passe');
                    fetch('/set-admin-pass', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({pass})}).then(()=>alert('Mot de passe Staff modifié !'));
                }
                function act(r,u,usr) { fetch(r,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:u,user:usr})}); }

                socket.on('init_admin', d => {
                    const lApp = document.getElementById('list-approved'); lApp.innerHTML = "";
                    d.approved.forEach(p => {
                        const div = document.createElement('div');
                        div.innerHTML = '<img src="'+p.url+'" style="width:80px;height:60px;object-fit:cover;border-radius:5px;"><button onclick="act(\'/delete\',\''+p.url+'\')" style="width:100%; font-size:10px; cursor:pointer;">🗑️</button>';
                        lApp.appendChild(div);
                    });
                });

                socket.on('new_photo_pending', p => {
                    const lPen = document.getElementById('list-pending');
                    const div = document.createElement('div');
                    div.style = "background:white; padding:10px; border-radius:10px; width:130px; border:2px solid #007bff;";
                    div.innerHTML = '<img src="'+p.url+'" style="width:100%; border-radius:5px;"><p style="font-size:11px; margin:5px 0;">'+p.user+'</p>' +
                        '<button onclick="this.parentElement.remove(); act(\'/approve\',\''+p.url+'\',\''+p.user+'\')" style="background:#28a745; color:white; width:48%; border:none; padding:5px; cursor:pointer; border-radius:5px;">OUI</button>' +
                        '<button onclick="this.parentElement.remove(); act(\'/delete\',\''+p.url+'\',\''+p.user+'\')" style="background:#dc3545; color:white; width:48%; border:none; padding:5px; cursor:pointer; border-radius:5px;">NON</button>';
                    lPen.prepend(div);
                });
            </script>
        </body>
    `);
});

// --- 3. ACTIONS BACKEND ---
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

app.post('/set-code', isAdmin, (req, res) => { eventCode = req.body.code; refreshAll(); res.sendStatus(200); });

app.post('/set-admin-pass', isAdmin, (req, res) => {
    const hashed = bcrypt.hashSync(req.body.pass, 10);
    fs.writeFileSync(USERS_FILE, JSON.stringify([{ id: "admin", pass: hashed }]));
    res.sendStatus(200);
});

app.post('/upload', upload.single('photo'), (req, res) => {
    const data = { url: '/uploads/'+req.file.filename, user: req.body.username };
    if (autoApprove) approvedPhotos.push(data); else io.emit('new_photo_pending', data);
    refreshAll(); res.sendStatus(200);
});

app.post('/approve', isAdmin, (req, res) => { approvedPhotos.push(req.body); refreshAll(); res.sendStatus(200); });
app.post('/delete', isAdmin, (req, res) => { approvedPhotos = approvedPhotos.filter(x => x.url !== req.body.url); refreshAll(); res.sendStatus(200); });

app.get('/admin/download-zip', isAdmin, async (req, res) => {
    const zip = new JSZip();
    approvedPhotos.forEach(p => { const f = path.join(publicPath, p.url); if (fs.existsSync(f)) zip.file(path.basename(p.url), fs.readFileSync(f)); });
    const content = await zip.generateAsync({ type: "nodebuffer" });
    res.setHeader('Content-Type', 'application/zip'); res.setHeader('Content-Disposition', 'attachment; filename=photos.zip');
    res.send(content);
});

app.get('/gallery', isPublic, (req, res) => {
    res.send(`<body style="background:#121212;color:white;text-align:center;padding:20px; font-family:sans-serif;"><h2>🖼️ Galerie</h2><div id="grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:10px;"></div><button onclick="location.href='/'" style="margin-top:20px;padding:15px;background:#007bff;color:white;border:none;border-radius:10px;">RETOUR</button><script src="/socket.io/socket.io.js"></script><script>const socket=io({query:{page:'gallery'}});socket.on('init_photos',d=>{document.getElementById('grid').innerHTML=d.photos.map(p=>'<img src="'+p.url+'" style="width:100%; aspect-ratio:1/1; object-fit:cover; border-radius:10px;">').join('')})</script></body>`);
});

app.get('/retro', (req, res) => {
    res.send(`
        <body style="background:black; color:white; margin:0; overflow:hidden; font-family:sans-serif;">
            <div id="c" style="height:100vh; width:100vw; display:flex; align-items:center; justify-content:center; position:relative;">
                <img id="img" style="max-width:100%; max-height:100vh; transition: opacity 1s; opacity:0; object-fit: contain;">
                <div id="tag" style="position:absolute; bottom:50px; right:50px; background:rgba(0,0,0,0.6); padding:15px 30px; border-radius:40px; font-size:24px; display:none;"></div>
            </div>
            <script src="/socket.io/socket.io.js"></script>
            <script>
                const socket = io({ query: { page: 'retro' } });
                let photos = [], idx = 0, dur = 7000;
                socket.on('init_photos', d => { photos = d.photos; dur = d.duration; if(photos.length && !window.started) start(); });
                function start() {
                    window.started = true;
                    const i = document.getElementById('img'); const t = document.getElementById('tag');
                    function next() {
                        if(!photos.length) return;
                        i.style.opacity = 0;
                        setTimeout(() => {
                            i.src = photos[idx].url; t.innerText = "📸 " + photos[idx].user; t.style.display = 'block';
                            i.style.opacity = 1; idx = (idx + 1) % photos.length;
                        }, 1000);
                        setTimeout(next, dur);
                    }
                    next();
                }
            </script>
        </body>
    `);
});

server.listen(PORT, () => { console.log("🚀 Serveur démarré sur le port " + PORT); refreshAll(); });
