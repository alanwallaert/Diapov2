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
let isEventActive = true; 
let activeClients = {};

// Lecture de la base de données au démarrage
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

if (!fs.existsSync(USERS_FILE)) {
    const hashed = bcrypt.hashSync("1234", 10);
    fs.writeFileSync(USERS_FILE, JSON.stringify([{ id: "admin", pass: hashed }]));
}

app.use(session({ secret: 'prestation-top-secret', resave: false, saveUninitialized: true }));
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
    let stats = { home: [], gallery: [], retro: [] };
    Object.values(activeClients).forEach(c => {
        if (stats[c.page]) stats[c.page].push(c.name);
    });
    io.emit('init_photos', { photos: approvedPhotos, duration: slideDuration });
    io.emit('init_admin', { 
        approved: approvedPhotos, 
        rejected: rejectedPhotos, 
        trashed: trashedPhotos, 
        autoApprove, 
        slideDuration, 
        eventCode,
        isEventActive,
        stats: stats 
    });
}

io.on('connection', (socket) => {
    const { page, name } = socket.handshake.query;
    if (page && page !== 'admin') activeClients[socket.id] = { name: name || "Anonyme", page: page };
    refreshAll();
    socket.on('disconnect', () => { delete activeClients[socket.id]; refreshAll(); });
});

// --- GESTION DES ROUTES ---

app.get('/', (req, res) => {
    if (req.session.user === 'admin') return res.redirect('/admin');
    if (req.session.user === 'public') return res.redirect('/upload-page');
    res.send(`
        <body style="font-family:sans-serif; background:#121212; color:white; display:flex; align-items:center; justify-content:center; height:100vh; margin:0;">
            <form action="/login" method="POST" style="background:#1e1e1e; padding:30px; border-radius:20px; width:300px; text-align:center;">
                <h2 style="color:#28a745; margin-bottom:25px;">Accès Prestation</h2>
                <input type="text" name="userid" placeholder="Identifiant (admin ou public)" required style="width:100%; padding:12px; margin-bottom:15px; border-radius:10px; border:none; background:#333; color:white;">
                <input type="password" name="password" placeholder="Mot de passe ou Code" required style="width:100%; padding:12px; margin-bottom:25px; border-radius:10px; border:none; background:#333; color:white;">
                <button type="submit" style="width:100%; padding:15px; background:#28a745; color:white; border:none; border-radius:10px; cursor:pointer; font-weight:bold;">SE CONNECTER</button>
            </form>
        </body>
    `);
});

app.post('/login', (req, res) => {
    const { userid, password } = req.body;
    if (userid === 'admin') {
        const users = JSON.parse(fs.readFileSync(USERS_FILE));
        const adminUser = users.find(u => u.id === 'admin');
        if (adminUser && bcrypt.compareSync(password, adminUser.pass)) {
            req.session.user = 'admin';
            return res.redirect('/admin');
        }
    } else if (userid === 'public') {
        if (!isEventActive) return res.send("<script>alert('Événement clôturé'); window.location='/';</script>");
        if (password === eventCode) {
            req.session.user = 'public';
            return res.redirect('/upload-page');
        }
    }
    res.send("<script>alert('Erreur identifiants'); window.location='/';</script>");
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

const isAdmin = (req, res, next) => { if (req.session.user === 'admin') next(); else res.redirect('/'); };
const isPublic = (req, res, next) => { if (req.session.user === 'public' || req.session.user === 'admin') next(); else res.redirect('/'); };

// --- PAGE MOBILE ---
app.get('/upload-page', isPublic, (req, res) => {
    res.send(`
        <body style="font-family:sans-serif; text-align:center; background:#121212; color:white; padding:20px; margin:0;">
            <div style="background:#1e1e1e; padding:25px; border-radius:20px; max-width:400px; margin:auto;">
                <h2 style="margin-bottom:25px;">📸 Partagez vos photos</h2>
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
                <p><a href="/logout" style="color:gray; font-size:11px; text-decoration:none;">Se déconnecter</a></p>
            </div>
            <script>
                document.getElementById('user').value = localStorage.getItem('p_name') || "";
                function handleFile(input, text) { input.parentElement.querySelector('span').innerText = text; }
                async function send() {
                    const cam = document.getElementById('file_cam').files[0];
                    const alb = document.getElementById('file_album').files[0];
                    const file = cam || alb;
                    const user = document.getElementById('user').value;
                    if(!file || !user) return alert("Prénom + Photo requis !");
                    const fd = new FormData(); fd.append('photo', file); fd.append('username', user);
                    await fetch('/upload', { method:'POST', body:fd });
                    alert("Envoyé avec succès !"); location.reload();
                }
            </script>
        </body>
    `);
});

// --- PAGE ADMIN COMPLÈTE ---
app.get('/admin', isAdmin, (req, res) => {
    res.send(`
        <body style="font-family:sans-serif; background:#f0f2f5; margin:0; padding:15px;">
            <div style="background:white; padding:15px; border-radius:15px; display:flex; justify-content:space-between; align-items:center; box-shadow:0 2px 10px rgba(0,0,0,0.1); margin-bottom:15px;">
                <h1 style="margin:0; font-size:18px;">🛡 Admin Panel</h1>
                <div onclick="document.getElementById('userModal').style.display='flex'" style="background:#e1f5fe; padding:8px 15px; border-radius:20px; cursor:pointer;">
                    <span style="color:#01579b; font-weight:bold; font-size:12px;">👥 EN LIGNE : <span id="total-online">0</span></span>
                </div>
                <div style="display:flex; gap:10px;">
                    <button onclick="showMainTab('photos')" style="padding:8px; border-radius:5px; border:none; background:#444; color:white; cursor:pointer;">PHOTOS</button>
                    <button onclick="showMainTab('users')" style="padding:8px; border-radius:5px; border:none; background:#444; color:white; cursor:pointer;">SYSTÈME</button>
                    <a href="/logout" style="text-decoration:none; color:white; background:#dc3545; padding:8px; border-radius:5px; font-weight:bold;">X</a>
                </div>
            </div>

            <div id="userModal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.8); z-index:1000; align-items:center; justify-content:center;" onclick="this.style.display='none'">
                <div style="background:white; width:90%; max-width:400px; border-radius:15px; padding:20px;" onclick="event.stopPropagation()">
                    <h3 style="margin-top:0;">Détails des connectés</h3>
                    <div id="user-details" style="max-height:300px; overflow-y:auto; font-size:14px; line-height:1.6;"></div>
                </div>
            </div>

            <div id="main-photos" class="main-tab">
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:15px;">
                    <div style="background:#fff; padding:12px; border-radius:10px; border:2px solid #28a745; display:flex; align-items:center; justify-content:space-between;">
                        <span style="font-weight:bold; color:#28a745; font-size:12px;">🚀 AUTO</span>
                        <input type="checkbox" id="autoCheck" onchange="fetch('/toggle-auto', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({state:this.checked})})">
                    </div>
                    <div style="background:#fff; padding:12px; border-radius:10px; border:2px solid #007bff;">
                        <span style="font-weight:bold; color:#007bff; font-size:11px;">⏱️ VITESSE : <span id="valDuration">7</span>s</span>
                        <input type="range" min="2" max="30" value="7" id="durationRange" style="width:100%;" onchange="fetch('/set-duration', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({duration: this.value * 1000})})">
                    </div>
                </div>
                <button onclick="location.href='/admin/download-zip'" style="width:100%; padding:15px; background:#6f42c1; color:white; border:none; border-radius:10px; font-weight:bold; margin-bottom:15px; cursor:pointer;">📥 TÉLÉCHARGER TOUTES LES PHOTOS (ZIP)</button>
                <div style="display:flex; gap:5px; margin-bottom:15px;">
                    <button onclick="showTab('pending')" id="btn-pending" style="flex:1; padding:10px; border:none; border-radius:8px; background:#007bff; color:white; font-size:12px;">ATTENTE</button>
                    <button onclick="showTab('approved')" id="btn-approved" style="flex:1; padding:10px; border:none; border-radius:8px; background:#ddd; font-size:12px;">OUI (<span id="nb-oui">0</span>)</button>
                    <button onclick="showTab('rejected')" id="btn-rejected" style="flex:1; padding:10px; border:none; border-radius:8px; background:#ddd; font-size:12px;">NON (<span id="nb-non">0</span>)</button>
                    <button onclick="showTab('trashed')" id="btn-trashed" style="flex:1; padding:10px; border:none; border-radius:8px; background:#ddd; font-size:12px;">🗑️</button>
                </div>
                <div id="tab-pending" class="tab-content"><div id="list-pending" style="display:flex; flex-wrap:wrap; gap:10px;"></div></div>
                <div id="tab-approved" class="tab-content" style="display:none;"><div id="list-approved" style="display:flex; flex-wrap:wrap; gap:10px;"></div></div>
                <div id="tab-rejected" class="tab-content" style="display:none;"><div id="list-rejected" style="display:flex; flex-wrap:wrap; gap:10px;"></div></div>
                <div id="tab-trashed" class="tab-content" style="display:none;"><div id="list-trashed" style="display:flex; flex-wrap:wrap; gap:10px;"></div></div>
            </div>

            <div id="main-users" class="main-tab" style="display:none;">
                <div style="background:white; padding:20px; border-radius:15px; margin-bottom:15px;">
                    <h3>🔑 PARAMÈTRES D'ACCÈS</h3>
                    <label>Code d'accès Public :</label><br>
                    <input type="text" id="eventCodeInput" style="padding:10px; margin-top:5px; border-radius:8px; border:1px solid #ddd; width:150px; text-align:center; font-weight:bold;">
                    <button onclick="updateCode()" style="padding:10px 20px; background:#28a745; color:white; border:none; border-radius:8px; cursor:pointer;">MODIFIER LE CODE</button>
                    <hr style="margin:20px 0; border:0; border-top:1px solid #eee;">
                    <div style="display:flex; align-items:center; justify-content:space-between;">
                        <span>Statut de l'événement :</span>
                        <button id="toggleEventBtn" onclick="toggleEvent()" style="padding:10px 20px; border-radius:8px; border:none; color:white; font-weight:bold; cursor:pointer;"></button>
                    </div>
                </div>
                <div style="background:white; padding:20px; border-radius:15px;">
                    <h3 style="color:#dc3545;">⚠️ ZONE DANGER</h3>
                    <button onclick="resetSystem()" style="width:100%; padding:15px; background:#dc3545; color:white; border:none; border-radius:10px; font-weight:bold; cursor:pointer;">TOUT RÉINITIALISER (PHOTOS + BASES)</button>
                </div>
            </div>

            <script src="/socket.io/socket.io.js"></script>
            <script>
                const socket = io();
                let eventIsActive = true;

                function showMainTab(m) { document.querySelectorAll('.main-tab').forEach(el=>el.style.display='none'); document.getElementById('main-'+m).style.display='block'; }
                function showTab(t) { 
                    document.querySelectorAll('.tab-content').forEach(el=>el.style.display='none'); 
                    document.querySelectorAll('button[id^="btn-"]').forEach(b=>{b.style.background='#ddd'; b.style.color='black';}); 
                    document.getElementById('tab-'+t).style.display='block'; 
                    document.getElementById('btn-'+t).style.background='#007bff';
                    document.getElementById('btn-'+t).style.color='white';
                }

                function updateCode() {
                    const code = document.getElementById('eventCodeInput').value;
                    fetch('/set-event-code', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({code})});
                    alert("Le code public est maintenant : " + code);
                }

                function toggleEvent() {
                    eventIsActive = !eventIsActive;
                    fetch('/toggle-event', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({state: eventIsActive})});
                }

                function resetSystem() { if(confirm("Supprimer TOUTES les photos définitivement ?")) fetch('/admin/reset',{method:'POST'}).then(()=>location.reload()); }
                function act(r,u,usr) { fetch(r,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:u,user:usr})}); }

                socket.on('init_admin', d => {
                    document.getElementById('total-online').innerText = d.stats.home.length + d.stats.gallery.length + d.stats.retro.length;
                    document.getElementById('user-details').innerHTML = \`<b>Accueil :</b> \${d.stats.home.join(', ') || 'aucun'}<br><b>Galerie :</b> \${d.stats.gallery.join(', ') || 'aucun'}<br><b>Diapo :</b> \${d.stats.retro.join(', ') || 'aucun'}\`;
                    document.getElementById('nb-oui').innerText = d.approved.length;
                    document.getElementById('nb-non').innerText = d.rejected.length;
                    document.getElementById('autoCheck').checked = d.autoApprove;
                    document.getElementById('eventCodeInput').value = d.eventCode;
                    document.getElementById('valDuration').innerText = d.slideDuration / 1000;
                    
                    eventIsActive = d.isEventActive;
                    const btn = document.getElementById('toggleEventBtn');
                    btn.innerText = eventIsActive ? "OUVERT" : "FERMÉ";
                    btn.style.background = eventIsActive ? "#28a745" : "#dc3545";

                    ['approved','rejected','trashed'].forEach(type => {
                        const l = document.getElementById('list-'+type); l.innerHTML = "";
                        d[type].forEach(p => {
                            const div = document.createElement('div');
                            div.style = "background:white; padding:5px; border-radius:8px; width:90px; text-align:center; box-shadow:0 1px 3px rgba(0,0,0,0.1);";
                            div.innerHTML = \`<img src="\${p.url}" style="width:100%; height:60px; object-fit:cover; border-radius:5px;"><button onclick="act('/delete','\${p.url}')" style="width:100%; background:black; color:white; border:none; margin-top:5px; font-size:10px; cursor:pointer;">🗑️</button>\`;
                            l.appendChild(div);
                        });
                    });
                });

                socket.on('new_photo_pending', p => {
                    const l = document.getElementById('list-pending');
                    const div = document.createElement('div');
                    div.style = "background:white; padding:10px; border-radius:10px; width:130px; border:2px solid #007bff;";
                    div.innerHTML = \`<img src="\${p.url}" style="width:100%; border-radius:5px;"><p style="font-size:11px; margin:5px 0;">\${p.user}</p>
                        <button onclick="this.parentElement.remove(); act('/approve','\${p.url}','\${p.user}')" style="background:#28a745; color:white; width:48%; border:none; padding:5px; cursor:pointer;">OUI</button>
                        <button onclick="this.parentElement.remove(); act('/reject','\${p.url}','\${p.user}')" style="background:#dc3545; color:white; width:48%; border:none; padding:5px; cursor:pointer;">NON</button>\`;
                    l.prepend(div);
                });
            </script>
        </body>
    `);
});

// --- ACTIONS ADMIN BACKEND ---

app.post('/set-event-code', isAdmin, (req, res) => { eventCode = req.body.code; refreshAll(); res.sendStatus(200); });
app.post('/toggle-event', isAdmin, (req, res) => { isEventActive = req.body.state; refreshAll(); res.sendStatus(200); });
app.post('/toggle-auto', isAdmin, (req, res) => { autoApprove = req.body.state; refreshAll(); res.sendStatus(200); });
app.post('/set-duration', isAdmin, (req, res) => { slideDuration = parseInt(req.body.duration); refreshAll(); res.sendStatus(200); });

app.post('/approve', isAdmin, (req, res) => {
    const p = req.body;
    rejectedPhotos = rejectedPhotos.filter(x => x.url !== p.url);
    trashedPhotos = trashedPhotos.filter(x => x.url !== p.url);
    if(!approvedPhotos.some(x => x.url === p.url)) approvedPhotos.push(p);
    refreshAll(); res.sendStatus(200);
});

app.post('/reject', isAdmin, (req, res) => {
    const p = req.body;
    approvedPhotos = approvedPhotos.filter(x => x.url !== p.url);
    if(!rejectedPhotos.some(x => x.url === p.url)) rejectedPhotos.push(p);
    refreshAll(); res.sendStatus(200);
});

app.post('/delete', isAdmin, (req, res) => {
    const p = req.body;
    approvedPhotos = approvedPhotos.filter(x => x.url !== p.url);
    rejectedPhotos = rejectedPhotos.filter(x => x.url !== p.url);
    if(!trashedPhotos.some(x => x.url === p.url)) trashedPhotos.push(p);
    refreshAll(); res.sendStatus(200);
});

app.post('/admin/reset', isAdmin, (req, res) => {
    approvedPhotos = []; rejectedPhotos = []; trashedPhotos = [];
    refreshAll(); res.sendStatus(200);
});

app.get('/admin/download-zip', isAdmin, async (req, res) => {
    const zip = new JSZip();
    approvedPhotos.forEach(p => {
        const filePath = path.join(publicPath, p.url);
        if (fs.existsSync(filePath)) zip.file(path.basename(p.url), fs.readFileSync(filePath));
    });
    const content = await zip.generateAsync({ type: "nodebuffer" });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=photos_evenement.zip');
    res.send(content);
});

// --- ROUTES GÉNÉRALES ---

app.post('/upload', upload.single('photo'), (req, res) => {
    const data = { url: '/uploads/'+req.file.filename, user: req.body.username };
    if (autoApprove) approvedPhotos.push(data);
    else io.emit('new_photo_pending', data);
    refreshAll(); res.sendStatus(200);
});

app.get('/gallery', isPublic, (req, res) => {
    res.send(`
        <body style="background:#121212; color:white; text-align:center; font-family:sans-serif; padding:20px;">
            <h2>🖼️ Galerie Photos</h2>
            <div id="grid" style="display:grid; grid-template-columns:repeat(auto-fill,minmax(110px,1fr)); gap:10px;"></div>
            <button onclick="location.href='/'" style="margin-top:20px; padding:15px; background:#007bff; color:white; border:none; border-radius:8px; font-weight:bold;">RETOUR</button>
            <script src="/socket.io/socket.io.js"></script>
            <script>
                const socket = io({ query: { page: 'gallery', name: localStorage.getItem('p_name') || 'Anonyme' } });
                socket.on('init_photos', d => {
                    const g = document.getElementById('grid'); g.innerHTML = "";
                    d.photos.forEach(p => { g.innerHTML += '<img src="'+p.url+'" style="width:100%; aspect-ratio:1/1; object-fit:cover; border-radius:10px;">'; });
                });
            </script>
        </body>
    `);
});

app.get('/retro', (req, res) => {
    res.send(`
        <body style="background:black; color:white; margin:0; overflow:hidden; text-align:center;">
            <div id="main" style="height:100vh; display:flex; align-items:center; justify-content:center; position:relative;">
                <h1 id="msg">En attente de photos...</h1>
                <img id="img" style="max-width:100%; max-height:100vh; display:none; transition: opacity 1s; object-fit: contain;">
                <div id="tag" style="position:absolute; bottom:50px; background:rgba(0,0,0,0.7); padding:10px 30px; border-radius:30px; font-size:30px; display:none;"></div>
            </div>
            <script src="/socket.io/socket.io.js"></script>
            <script>
                const socket = io({ query: { page: 'retro', name: 'Écran Diapo' } });
                let list = [], cur = 0, t = null, dur = 7000;
                socket.on('init_photos', d => { list = d.photos; dur = d.duration; if(!t && list.length) loop(); });
                function loop() {
                    if(!list.length) return;
                    const i = document.getElementById('img'); const tag = document.getElementById('tag');
                    document.getElementById('msg').style.display='none'; i.style.display='block'; tag.style.display='block';
                    i.style.opacity = 0;
                    setTimeout(() => { i.src = list[cur].url; tag.innerText = "📸 " + list[cur].user; i.style.opacity = 1; cur = (cur + 1) % list.length; }, 1000);
                    setTimeout(loop, dur);
                }
            </script>
        </body>
    `);
});

server.listen(PORT, () => { console.log("🚀 Serveur en ligne sur le port " + PORT); refreshAll(); });
