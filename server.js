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
let transitionEffect = "fade"; 
let activeClients = {};

// Lecture de la base de données
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
        transitionEffect = data.transitionEffect || "fade";
    } catch(e) { console.log("Erreur lecture DB"); }
}

function saveDB() {
    const data = { approved: approvedPhotos, rejected: rejectedPhotos, trashed: trashedPhotos, autoApprove, slideDuration, eventCode, isEventActive, transitionEffect };
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

const publicPath = path.join(__dirname, 'public');
const uploadPath = path.join(publicPath, 'uploads');
const trashPath = path.join(publicPath, 'trash');

[publicPath, uploadPath, trashPath].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

if (!fs.existsSync(USERS_FILE)) {
    const hashed = bcrypt.hashSync("1234", 10);
    fs.writeFileSync(USERS_FILE, JSON.stringify([{ id: "admin", pass: hashed }]));
}

app.use(session({ secret: 'prestation-top-secret', resave: false, saveUninitialized: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(publicPath));

app.get('/manifest.json', (req, res) => {
    res.sendFile(path.join(__dirname, 'manifest.json'));
});

const storage = multer.diskStorage({
    destination: uploadPath,
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// --- MIDDLEWARES ---
const checkAuth = (req, res, next) => {
    if (req.session.user) next();
    else res.redirect('/login');
};

const checkEventAccess = (req, res, next) => {
    if (!isEventActive) return res.send(`<body style="background:#121212;color:white;text-align:center;padding:50px;font-family:sans-serif;"><h1>🔒 Prestation terminée</h1><p>L'accès est fermé.</p></body>`);
    if (req.session.hasAccess) return next();
    res.send(`
        <body style="background:#121212;color:white;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;">
            <div style="background:#1e1e1e;padding:40px;border-radius:20px;text-align:center;width:300px;">
                <h2 style="color:#28a745;">Code d'accès</h2>
                <input type="text" id="c" placeholder="CODE ICI" style="width:100%;padding:15px;margin-bottom:20px;border-radius:10px;border:none;background:#333;color:white;text-align:center;font-size:24px;letter-spacing:3px;">
                <button onclick="check()" style="width:100%;padding:15px;background:#28a745;color:white;border:none;border-radius:10px;font-weight:bold;cursor:pointer;">ENTRER</button>
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

// --- ROUTES AUTH ---
app.get('/login', (req, res) => {
    res.send(`
        <body style="font-family:sans-serif; background:#121212; color:white; display:flex; align-items:center; justify-content:center; height:100vh; margin:0;">
            <form action="/login" method="POST" style="background:#1e1e1e; padding:30px; border-radius:15px; width:280px; text-align:center;">
                <h2 style="color:#28a745; margin-top:0;">Prestation Admin</h2>
                <input type="text" name="userid" placeholder="Identifiant" required style="width:100%; padding:12px; margin-bottom:10px; border-radius:8px; border:none; background:#333; color:white;">
                <input type="password" name="password" placeholder="Mot de passe" required style="width:100%; padding:12px; margin-bottom:20px; border-radius:8px; border:none; background:#333; color:white;">
                <button type="submit" style="width:100%; padding:12px; background:#28a745; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:bold;">SE CONNECTER</button>
            </form>
        </body>
    `);
});

app.post('/login', (req, res) => {
    const users = JSON.parse(fs.readFileSync(USERS_FILE));
    const user = users.find(u => u.id === req.body.userid);
    if (user && bcrypt.compareSync(req.body.password, user.pass)) {
        req.session.user = user.id;
        res.redirect('/admin');
    } else res.send("<script>alert('Erreur'); window.location='/login';</script>");
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

app.post('/verify-code', (req, res) => {
    if (req.body.code === eventCode) { req.session.hasAccess = true; res.sendStatus(200); }
    else res.sendStatus(403);
});

// --- ROUTES CLIENT ---
app.get('/', checkEventAccess, (req, res) => {
    res.send(`
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
                    const cam = document.getElementById('file_cam').files[0];
                    const alb = document.getElementById('file_album').files[0];
                    const file = cam || alb;
                    const user = document.getElementById('user').value;
                    if(!file || !user) return alert("Nom + Photo !");
                    const fd = new FormData(); fd.append('photo', file); fd.append('username', user);
                    await fetch('/upload', { method:'POST', body:fd });
                    alert("Envoyé !"); location.reload();
                }
            </script>
        </body>
    `);
});

app.get('/gallery', checkEventAccess, (req, res) => {
    res.send(`<body style="background:#121212;color:white;font-family:sans-serif;padding:20px;text-align:center;"><h2>🖼️ Galerie</h2><div id="grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;"></div><button onclick="location.href='/'" style="margin-top:20px;padding:10px;background:#007bff;color:white;border:none;border-radius:8px;">RETOUR</button><script src="/socket.io/socket.io.js"></script><script>const socket=io({ query: { page: 'gallery', name: localStorage.getItem('p_name') || 'Anonyme' } });socket.on('init_photos',data=>{const g=document.getElementById('grid');g.innerHTML="";data.photos.forEach(p=>{g.innerHTML+='<img src="'+p.url+'" style="width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:10px;">';});});</script></body>`);
});

// --- ROUTES ADMIN ---
app.get('/admin', checkAuth, (req, res) => {
    res.send(`
        <body style="font-family:sans-serif; background:#f0f2f5; margin:0; padding:15px;">
            <div style="background:white; padding:15px; border-radius:15px; display:flex; justify-content:space-between; align-items:center; box-shadow:0 2px 10px rgba(0,0,0,0.1); margin-bottom:15px;">
                <h1 style="margin:0; font-size:18px;">🛡 Admin</h1>
                <div style="display:flex; gap:10px;">
                    <button onclick="showMainTab('photos')" style="padding:8px; border-radius:5px; border:none; background:#444; color:white;">PHOTOS</button>
                    <button onclick="showMainTab('users')" style="padding:8px; border-radius:5px; border:none; background:#444; color:white;">SYSTÈME</button>
                    <a href="/logout" style="text-decoration:none; color:white; background:#dc3545; padding:8px; border-radius:5px;">X</a>
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
                        <input type="range" min="2" max="30" value="7" id="durationRange" style="width:100%;" oninput="document.getElementById('valDuration').innerText=this.value" onchange="fetch('/set-duration', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({duration: this.value * 1000})})">
                    </div>
                </div>
                <div id="tab-pending" class="tab-content"><div id="list-pending" style="display:flex; flex-wrap:wrap; gap:10px;"></div></div>
            </div>

            <div id="main-users" class="main-tab" style="display:none;">
                <div style="background:white; padding:20px; border-radius:15px; margin-bottom:15px; border:1px solid #eee;">
                    <h3 style="margin-top:0; color:#007bff;">🎬 EFFET DIAPORAMA</h3>
                    <select id="effectSelect" onchange="updateEffect()" style="width:100%; padding:12px; border-radius:8px; background:#f9f9f9; font-weight:bold; font-size:16px;">
                        <option value="fade">Fondu Croisé</option>
                        <option value="zoom">Zoom Progressif</option>
                        <option value="slide">Glissement Latéral</option>
                        <option value="none">Aucun</option>
                    </select>
                </div>
                <div style="background:white; padding:20px; border-radius:15px; border:1px solid #eee;">
                    <h3 style="margin-top:0; color:#007bff;">📱 ACCÈS</h3>
                    <input type="text" id="eventCodeInput" placeholder="Code" style="padding:10px; border-radius:8px; border:1px solid #ddd; width:80px; text-align:center;">
                    <button onclick="updateEventCode()" style="padding:10px 20px; background:#28a745; color:white; border:none; border-radius:8px;">OK</button>
                    <button id="toggleEventBtn" onclick="toggleEvent()" style="margin-top:10px; width:100%; padding:10px; border:none; border-radius:8px; color:white; font-weight:bold;"></button>
                </div>
            </div>

            <script src="/socket.io/socket.io.js"></script>
            <script>
                const socket = io();
                function showMainTab(m) { document.querySelectorAll('.main-tab').forEach(el=>el.style.display='none'); document.getElementById('main-'+m).style.display='block'; }
                function updateEffect() {
                    const eff = document.getElementById('effectSelect').value;
                    fetch('/set-effect', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({effect: eff}) });
                }
                function updateEventCode() {
                    const code = document.getElementById('eventCodeInput').value;
                    fetch('/set-event-code', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({code}) });
                    alert("Code mis à jour !");
                }
                function toggleEvent() {
                    const status = document.getElementById('toggleEventBtn').innerText === "FERMER";
                    fetch('/toggle-event', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({state: !status}) });
                }

                socket.on('init_admin', d => {
                    document.getElementById('effectSelect').value = d.transitionEffect || 'fade';
                    document.getElementById('eventCodeInput').value = d.eventCode;
                    document.getElementById('autoCheck').checked = d.autoApprove;
                    document.getElementById('durationRange').value = d.slideDuration / 1000;
                    document.getElementById('valDuration').innerText = d.slideDuration / 1000;
                    const btn = document.getElementById('toggleEventBtn');
                    btn.innerText = d.isEventActive ? "FERMER" : "OUVRIR";
                    btn.style.background = d.isEventActive ? "#dc3545" : "#28a745";

                    // Affichage des photos en attente (simplifié pour cet exemple)
                    const l = document.getElementById('list-pending'); l.innerHTML = "";
                    d.approved.forEach(p => {
                        l.innerHTML += '<div style="width:80px;"><img src="'+p.url+'" style="width:100%;border-radius:5px;"><button onclick="act(\\'/delete\\',\\''+p.url+'\\')" style="width:100%;font-size:10px;background:black;color:white;border:none;">🗑️</button></div>';
                    });
                });
                function act(r,u) { fetch(r,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:u})}); }
            </script>
        </body>
    `);
});

// --- ACTIONS ADMIN ---
app.post('/set-event-code', checkAuth, (req, res) => { eventCode = req.body.code; refreshAll(); res.sendStatus(200); });
app.post('/toggle-event', checkAuth, (req, res) => { isEventActive = req.body.state; refreshAll(); res.sendStatus(200); });
app.post('/set-effect', checkAuth, (req, res) => { transitionEffect = req.body.effect; refreshAll(); res.sendStatus(200); });
app.post('/set-duration', checkAuth, (req, res) => { slideDuration = parseInt(req.body.duration); refreshAll(); res.sendStatus(200); });
app.post('/toggle-auto', checkAuth, (req, res) => { autoApprove = req.body.state; refreshAll(); res.sendStatus(200); });
app.post('/delete', checkAuth, (req, res) => { approvedPhotos = approvedPhotos.filter(p => p.url !== req.body.url); refreshAll(); res.sendStatus(200); });

app.post('/upload', upload.single('photo'), (req, res) => {
    const data = { url: '/uploads/'+req.file.filename, user: req.body.username };
    if (autoApprove) { approvedPhotos.push(data); refreshAll(); }
    else io.emit('new_photo_pending', data);
    res.sendStatus(200);
});

// --- DIAPORAMA (RETRO) ---
app.get('/retro', (req, res) => {
    res.send(`
        <style>
            body { background: black; color: white; margin: 0; overflow: hidden; font-family: sans-serif; cursor: pointer; }
            #main { height: 100vh; width: 100vw; position: relative; display: flex; align-items: center; justify-content: center; }
            .slide { position: absolute; max-width: 100%; max-height: 100%; object-fit: contain; opacity: 0; z-index: 1; }
            .effect-fade { transition: opacity 1.5s ease-in-out; }
            .effect-fade.active { opacity: 1; z-index: 2; }
            .effect-zoom { transition: opacity 1.5s ease-in-out, transform 8s linear; transform: scale(1); }
            .effect-zoom.active { opacity: 1; z-index: 2; transform: scale(1.15); }
            .effect-slide { transition: all 1s cubic-bezier(0.4, 0, 0.2, 1); transform: translateX(100%); }
            .effect-slide.active { opacity: 1; z-index: 2; transform: translateX(0); }
            .effect-slide.exit { transform: translateX(-100%); opacity: 0; }
            .effect-none.active { opacity: 1; z-index: 2; transition: none; }
            #tag { position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.6); padding: 15px 40px; border-radius: 50px; font-size: 30px; z-index: 10; opacity: 0; transition: opacity 1s; }
            #tag.visible { opacity: 1; }
            #qr-container { position: absolute; bottom: 20px; right: 20px; background: white; padding: 10px; border-radius: 15px; display: flex; flex-direction: column; align-items: center; z-index: 20; }
        </style>
        <body onclick="toggleFS()">
            <div id="start-btn" style="position:fixed; inset:0; background:rgba(0,0,0,0.95); z-index:100; display:flex; align-items:center; justify-content:center;">
                <button onclick="start(event)" style="padding:20px 40px; font-size:22px; border-radius:40px; background:#28a745; color:white; border:none; cursor:pointer;">📽️ LANCER LE DIAPORAMA</button>
            </div>
            <div id="main">
                <img id="img1" class="slide">
                <img id="img2" class="slide">
                <div id="tag"></div>
                <div id="qr-container">
                    <div id="code-area" style="display:none; text-align:center; margin-bottom:5px;">
                        <span style="color:#666; font-size:10px; font-weight:bold; display:block;">CODE D'ACCÈS</span>
                        <span id="code-display" style="color:#28a745; font-size:20px; font-weight:900;">----</span>
                    </div>
                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=https://diapov2.onrender.com/" style="width:100px;">
                </div>
            </div>
            <script src="/socket.io/socket.io.js"></script>
            <script>
                const socket = io({ query: { page: 'retro', name: 'Écran Diapo' } });
                let list = []; let cur = 0; let t = null; let duration = 7000; let currentEffect = "fade"; let activeImgSlot = 1;
                function toggleFS() { if (!document.fullscreenElement) document.documentElement.requestFullscreen(); }
                socket.on('init_admin', d => {
                    document.getElementById('code-area').style.display = d.isEventActive ? 'block' : 'none';
                    document.getElementById('code-display').innerText = d.eventCode;
                });
                socket.on('init_photos', data => { 
                    list = data.photos; duration = data.duration; currentEffect = data.effect || "fade";
                    if (t) { clearInterval(t); t = setInterval(loop, duration); }
                });
                function start(e) { e.stopPropagation(); document.getElementById('start-btn').style.display='none'; if(list.length) { loop(); t = setInterval(loop, duration); } }
                function loop() {
                    if(!list.length) return;
                    const nextImg = document.getElementById(activeImgSlot === 1 ? 'img2' : 'img1');
                    const currentImg = document.getElementById(activeImgSlot === 1 ? 'img1' : 'img2');
                    nextImg.className = 'slide effect-' + currentEffect;
                    nextImg.src = list[cur].url;
                    nextImg.onload = () => {
                        if(currentEffect === 'slide') currentImg.classList.add('exit');
                        nextImg.classList.add('active');
                        currentImg.classList.remove('active');
                        document.getElementById('tag').innerText = "📸 " + list[cur].user;
                        document.getElementById('tag').classList.add('visible');
                        activeImgSlot = activeImgSlot === 1 ? 2 : 1;
                        cur = (cur + 1) % list.length;
                    };
                }
            </script>
        </body>
    `);
});

// --- LOGIQUE CORE ---
function refreshAll() {
    saveDB();
    io.emit('init_photos', { photos: approvedPhotos, duration: slideDuration, effect: transitionEffect });
    io.emit('init_admin', { approved: approvedPhotos, rejected: rejectedPhotos, trashed: trashedPhotos, autoApprove, slideDuration, eventCode, isEventActive, transitionEffect });
}

io.on('connection', (socket) => {
    refreshAll();
});

setInterval(() => { http.get('https://diapov2.onrender.com/', (res) => {}); }, 840000);
server.listen(PORT, () => { console.log("🚀 Port " + PORT); });
