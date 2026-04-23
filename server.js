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
let transitionEffect = "fade"; // Nouvelle option : fade, zoom, slide
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

app.post('/verify-code', (req, res) => {
    if (req.body.code === eventCode) { req.session.hasAccess = true; res.sendStatus(200); }
    else res.sendStatus(403);
});

function refreshAll() {
    saveDB();
    let stats = { home: [], gallery: [], retro: [] };
    Object.values(activeClients).forEach(c => {
        if (stats[c.page]) stats[c.page].push(c.name);
    });
    io.emit('init_photos', { photos: approvedPhotos, duration: slideDuration, effect: transitionEffect });
    io.emit('init_admin', { 
        approved: approvedPhotos, 
        rejected: rejectedPhotos, 
        trashed: trashedPhotos, 
        autoApprove, 
        slideDuration, 
        eventCode, 
        isEventActive, 
        transitionEffect,
        stats: stats 
    });
}

io.on('connection', (socket) => {
    const { page, name } = socket.handshake.query;
    if (page && page !== 'admin') activeClients[socket.id] = { name: name || "Anonyme", page: page };
    refreshAll();
    socket.on('disconnect', () => { delete activeClients[socket.id]; refreshAll(); });
});

// --- ROUTES ADMIN ACTIONS ---
app.post('/set-event-code', checkAuth, (req, res) => { eventCode = req.body.code; refreshAll(); res.sendStatus(200); });
app.post('/toggle-event', checkAuth, (req, res) => { isEventActive = req.body.state; refreshAll(); res.sendStatus(200); });
app.post('/set-effect', checkAuth, (req, res) => { transitionEffect = req.body.effect; refreshAll(); res.sendStatus(200); });

// (Gardez les autres routes /login, /upload, /approve etc. identiques à votre version précédente)
// [Insérez ici vos routes existantes : /login, /logout, /, /admin, /upload, /gallery etc.]
// Je passe directement à la partie modifiée de l'admin et du retro pour plus de clarté :

// --- ROUTE ADMIN (MODIFIÉE POUR L'OPTION EFFETS) ---
app.get('/admin', checkAuth, (req, res) => {
    res.send(`
        <body style="font-family:sans-serif; background:#f0f2f5; margin:0; padding:15px;">
            <div style="background:white; padding:15px; border-radius:15px; display:flex; justify-content:space-between; align-items:center; box-shadow:0 2px 10px rgba(0,0,0,0.1); margin-bottom:15px;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=https://diapov2.onrender.com/" style="width:60px; border-radius:5px;">
                    <h1 style="margin:0; font-size:18px;">🛡 Admin</h1>
                </div>
                <div style="display:flex; gap:10px;">
                    <button onclick="showMainTab('photos')" style="padding:8px; border-radius:5px; border:none; background:#444; color:white;">PHOTOS</button>
                    <button onclick="showMainTab('users')" style="padding:8px; border-radius:5px; border:none; background:#444; color:white;">SYSTÈME</button>
                    <a href="/logout" style="text-decoration:none; color:white; background:#dc3545; padding:8px; border-radius:5px;">X</a>
                </div>
            </div>

            <div id="main-photos" class="main-tab">
                <div style="background:#fff; padding:12px; border-radius:10px; border:2px solid #007bff; margin-bottom:15px;">
                    <span style="font-weight:bold; color:#007bff; font-size:11px;">⏱️ VITESSE : <span id="valDuration">7</span>s</span>
                    <input type="range" min="2" max="30" value="7" id="durationRange" style="width:100%;" oninput="document.getElementById('valDuration').innerText=this.value" onchange="fetch('/set-duration', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({duration: this.value * 1000})})">
                </div>
                <button onclick="location.href='/admin/download-zip'" style="width:100%; padding:15px; background:#6f42c1; color:white; border:none; border-radius:10px; font-weight:bold; margin-bottom:15px;">📥 TÉLÉCHARGER (ZIP)</button>
                <div id="tab-pending" class="tab-content"><div id="list-pending" style="display:flex; flex-wrap:wrap; gap:10px;"></div></div>
            </div>

            <div id="main-users" class="main-tab" style="display:none;">
                <div style="background:white; padding:20px; border-radius:15px; margin-bottom:15px; border:1px solid #eee;">
                    <h3 style="margin-top:0; color:#007bff;">🎬 EFFET DIAPORAMA</h3>
                    <select id="effectSelect" onchange="updateEffect()" style="width:100%; padding:12px; border-radius:8px; background:#f9f9f9; font-weight:bold; font-size:16px;">
                        <option value="fade">Fondu Croisé (Standard)</option>
                        <option value="zoom">Zoom Progressif (Ken Burns)</option>
                        <option value="slide">Glissement Latéral</option>
                        <option value="none">Instantané (Sans effet)</option>
                    </select>
                </div>

                <div style="background:white; padding:20px; border-radius:15px; margin-bottom:15px; border:1px solid #eee;">
                    <h3 style="margin-top:0; color:#007bff;">📱 PARAMÈTRES MOBILE</h3>
                    <div style="display:flex; align-items:center; gap:15px; margin-bottom:20px;">
                        <label style="font-weight:bold; flex:1;">Code d'accès :</label>
                        <input type="text" id="eventCodeInput" style="padding:10px; border-radius:8px; border:1px solid #ddd; width:100px; text-align:center;">
                        <button onclick="updateEventCode()" style="padding:10px 20px; background:#28a745; color:white; border:none; border-radius:8px;">OK</button>
                    </div>
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

                socket.on('init_admin', d => {
                    document.getElementById('effectSelect').value = d.transitionEffect || 'fade';
                    // ... reste de l'init admin identique ...
                });
                // ... reste du script admin ...
            </script>
        </body>
    `);
});

// --- ROUTE DIAPORAMA (MODIFIÉE POUR LES EFFETS) ---
app.get('/retro', (req, res) => {
    res.send(`
        <style>
            body { background: black; color: white; margin: 0; overflow: hidden; font-family: sans-serif; cursor: pointer; }
            #main { height: 100vh; width: 100vw; position: relative; display: flex; align-items: center; justify-content: center; }
            
            .slide { 
                position: absolute; 
                max-width: 100%; 
                max-height: 100%; 
                object-fit: contain; 
                opacity: 0; 
                z-index: 1;
            }

            /* --- SYSTÈME D'EFFETS --- */
            
            /* 1. FADE (Fondu) */
            .effect-fade { transition: opacity 1.5s ease-in-out; }
            .effect-fade.active { opacity: 1; z-index: 2; }

            /* 2. ZOOM (Ken Burns) */
            .effect-zoom { transition: opacity 1.5s ease-in-out, transform 8s linear; transform: scale(1); }
            .effect-zoom.active { opacity: 1; z-index: 2; transform: scale(1.15); }

            /* 3. SLIDE (Glissement) */
            .effect-slide { transition: all 1s cubic-bezier(0.4, 0, 0.2, 1); transform: translateX(100%); }
            .effect-slide.active { opacity: 1; z-index: 2; transform: translateX(0); }
            .effect-slide.exit { transform: translateX(-100%); opacity: 0; }

            /* 4. NONE (Instant) */
            .effect-none.active { opacity: 1; z-index: 2; transition: none; }

            #tag { 
                position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%);
                background: rgba(0,0,0,0.6); padding: 15px 40px; border-radius: 50px; 
                font-size: 30px; z-index: 10; opacity: 0; transition: opacity 1s;
            }
            #tag.visible { opacity: 1; }
        </style>

        <body onclick="toggleFS()">
            <div id="start-btn" style="position:fixed; inset:0; background:rgba(0,0,0,0.95); z-index:100; display:flex; align-items:center; justify-content:center;">
                <button onclick="start(event)" style="padding:20px 40px; font-size:22px; border-radius:40px; background:#28a745; color:white; border:none; cursor:pointer; font-weight:bold;">📽️ LANCER LE DIAPORAMA</button>
            </div>

            <div id="main">
                <img id="img1" class="slide">
                <img id="img2" class="slide">
                <div id="tag"></div>
                </div>

            <script src="/socket.io/socket.io.js"></script>
            <script>
                const socket = io({ query: { page: 'retro', name: 'Écran Diapo' } });
                let list = []; let cur = 0; let t = null; 
                let currentDuration = 7000;
                let currentEffect = "fade";
                let activeImgSlot = 1;

                socket.on('init_photos', (data) => { 
                    list = data.photos; 
                    currentDuration = data.duration;
                    currentEffect = data.effect || "fade";
                    if (t) { clearInterval(t); t = setInterval(loop, currentDuration); }
                });

                function start(e) { 
                    e.stopPropagation(); 
                    document.getElementById('start-btn').style.display='none'; 
                    if(list.length > 0) { loop(); t = setInterval(loop, currentDuration); }
                }

                function loop() {
                    if(!list.length) return;
                    
                    const nextImg = document.getElementById(activeImgSlot === 1 ? 'img2' : 'img1');
                    const currentImg = document.getElementById(activeImgSlot === 1 ? 'img1' : 'img2');
                    const tag = document.getElementById('tag');

                    // 1. Préparer l'image suivante (cachée)
                    nextImg.className = 'slide effect-' + currentEffect;
                    nextImg.src = list[cur].url;

                    nextImg.onload = () => {
                        // 2. Appliquer l'animation de sortie sur l'ancienne
                        if(currentEffect === 'slide') currentImg.classList.add('exit');
                        
                        // 3. Activer la nouvelle
                        nextImg.classList.add('active');
                        currentImg.classList.remove('active');
                        
                        tag.innerText = "📸 " + list[cur].user;
                        tag.className = 'visible';
                        
                        activeImgSlot = (activeImgSlot === 1 ? 2 : 1);
                        cur = (cur + 1) % list.length;
                    };
                }
                function toggleFS() { if (!document.fullscreenElement) document.documentElement.requestFullscreen(); }
            </script>
        </body>
    `);
});

// [Gardez le reste de votre script original avec le serveur listen]
server.listen(PORT, () => { console.log("🚀 Serveur lancé sur le port " + PORT); refreshAll(); });
