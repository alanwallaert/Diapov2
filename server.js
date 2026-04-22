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

const storage = multer.diskStorage({
    destination: uploadPath,
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// --- LOGIQUE DE CONNEXION UNIQUE ---
app.get('/', (req, res) => {
    if (req.session.user === 'admin') return res.redirect('/admin');
    if (req.session.user === 'public') return res.redirect('/upload-page');
    
    res.send(`
        <body style="font-family:sans-serif; background:#121212; color:white; display:flex; align-items:center; justify-content:center; height:100vh; margin:0;">
            <form action="/login" method="POST" style="background:#1e1e1e; padding:30px; border-radius:20px; width:300px; text-align:center; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
                <h2 style="color:#28a745; margin-bottom:25px;">Accès Prestation</h2>
                <input type="text" name="userid" placeholder="Identifiant (admin ou public)" required style="width:100%; padding:12px; margin-bottom:15px; border-radius:10px; border:none; background:#333; color:white;">
                <input type="password" name="password" placeholder="Mot de passe ou Code" required style="width:100%; padding:12px; margin-bottom:25px; border-radius:10px; border:none; background:#333; color:white;">
                <button type="submit" style="width:100%; padding:15px; background:#28a745; color:white; border:none; border-radius:10px; cursor:pointer; font-weight:bold; font-size:16px;">SE CONNECTER</button>
            </form>
        </body>
    `);
});

app.post('/login', (req, res) => {
    const { userid, password } = req.body;

    // Cas Admin
    if (userid === 'admin') {
        const users = JSON.parse(fs.readFileSync(USERS_FILE));
        const adminUser = users.find(u => u.id === 'admin');
        if (adminUser && bcrypt.compareSync(password, adminUser.pass)) {
            req.session.user = 'admin';
            return res.redirect('/admin');
        }
    } 
    // Cas Public
    else if (userid === 'public') {
        if (!isEventActive) return res.send("<script>alert('L\'événement est terminé.'); window.location='/';</script>");
        if (password === eventCode) {
            req.session.user = 'public';
            return res.redirect('/upload-page');
        }
    }
    res.send("<script>alert('Identifiant ou mot de passe incorrect'); window.location='/';</script>");
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// --- MIDDLEWARES DE PROTECTION ---
const isAdmin = (req, res, next) => { if (req.session.user === 'admin') next(); else res.redirect('/'); };
const isPublic = (req, res, next) => { if (req.session.user === 'public' || req.session.user === 'admin') next(); else res.redirect('/'); };

// --- PAGE ENVOI PHOTO (PUBLIC) ---
app.get('/upload-page', isPublic, (req, res) => {
    res.send(\`
        <!DOCTYPE html>
        <html lang="fr">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Envoyer une Photo</title>
        </head>
        <body style="font-family:sans-serif; text-align:center; background:#121212; color:white; padding:20px; margin:0;">
            <div style="background:#1e1e1e; padding:25px; border-radius:20px; max-width:400px; margin:auto;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                    <h2 style="margin:0;">📸 Partagez</h2>
                    <a href="/logout" style="color:#666; text-decoration:none; font-size:12px;">Déconnexion</a>
                </div>
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
                <button onclick="send()" style="width:100%; padding:20px; background:#28a745; color:white; border:none; border-radius:12px; margin-top:30px; cursor:pointer; font-weight:bold;">ENVOYER</button>
                <button onclick="location.href='/gallery'" style="width:100%; padding:15px; background:transparent; color:#007bff; border:2px solid #007bff; border-radius:12px; margin-top:15px; cursor:pointer; font-weight:bold;">🖼️ VOIR LES PHOTOS</button>
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
                    alert("Merci ! Photo envoyée."); location.reload();
                }
            </script>
        </body>
        </html>
    \`);
});

// --- PAGE ADMIN (IDENTIQUE À TA VERSION) ---
app.get('/admin', isAdmin, (req, res) => {
    res.send(\`
        <body style="font-family:sans-serif; background:#f0f2f5; margin:0; padding:15px;">
            <div style="background:white; padding:15px; border-radius:15px; display:flex; justify-content:space-between; align-items:center; box-shadow:0 2px 10px rgba(0,0,0,0.1); margin-bottom:15px;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <h1 style="margin:0; font-size:18px;">🛡 Dashboard Admin</h1>
                </div>
                <div style="display:flex; gap:10px;">
                    <button onclick="showMainTab('photos')" style="padding:8px; border-radius:5px; border:none; background:#444; color:white; cursor:pointer;">PHOTOS</button>
                    <button onclick="showMainTab('users')" style="padding:8px; border-radius:5px; border:none; background:#444; color:white; cursor:pointer;">SYSTÈME</button>
                    <a href="/logout" style="text-decoration:none; color:white; background:#dc3545; padding:8px; border-radius:5px; font-weight:bold;">X</a>
                </div>
            </div>

            <div id="main-photos" class="main-tab">
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:15px;">
                    <div style="background:#fff; padding:12px; border-radius:10px; border:2px solid #28a745; display:flex; align-items:center; justify-content:space-between;">
                        <span style="font-weight:bold; color:#28a745;">🚀 AUTO-APP</span>
                        <input type="checkbox" id="autoCheck" onchange="fetch('/toggle-auto', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({state:this.checked})})">
                    </div>
                </div>
                <div style="display:flex; gap:5px; margin-bottom:15px;">
                    <button onclick="showTab('pending')" id="btn-pending" style="flex:1; padding:10px; border-radius:8px; border:none; background:#007bff; color:white;">ATTENTE</button>
                    <button onclick="showTab('approved')" id="btn-approved" style="flex:1; padding:10px; border-radius:8px; border:none; background:#ddd;">OUI (<span id="nb-oui">0</span>)</button>
                    <button onclick="showTab('trashed')" id="btn-trashed" style="flex:1; padding:10px; border-radius:8px; border:none; background:#ddd;">🗑️</button>
                </div>
                <div id="tab-pending" class="tab-content"><div id="list-pending" style="display:flex; flex-wrap:wrap; gap:10px;"></div></div>
                <div id="tab-approved" class="tab-content" style="display:none;"><div id="list-approved" style="display:flex; flex-wrap:wrap; gap:10px;"></div></div>
                <div id="tab-trashed" class="tab-content" style="display:none;"><div id="list-trashed" style="display:flex; flex-wrap:wrap; gap:10px;"></div></div>
            </div>

            <div id="main-users" class="main-tab" style="display:none;">
                <div style="background:white; padding:20px; border-radius:15px; border:1px solid #eee;">
                    <h3 style="margin-top:0; color:#007bff;">📱 PARAMÈTRES MOBILE</h3>
                    <label>Code d'accès Public :</label>
                    <input type="text" id="eventCodeInput" style="padding:10px; border-radius:8px; border:1px solid #ddd; width:100px; text-align:center;">
                    <button onclick="updateEventCode()" style="padding:10px; background:#28a745; color:white; border:none; border-radius:8px; cursor:pointer;">OK</button>
                </div>
            </div>

            <script src="/socket.io/socket.io.js"></script>
            <script>
                const socket = io();
                function showMainTab(m) { document.querySelectorAll('.main-tab').forEach(el=>el.style.display='none'); document.getElementById('main-'+m).style.display='block'; }
                function showTab(t) { document.querySelectorAll('.tab-content').forEach(el=>el.style.display='none'); document.getElementById('tab-'+t).style.display='block'; }
                
                function updateEventCode() {
                    const code = document.getElementById('eventCodeInput').value;
                    fetch('/set-event-code', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({code}) });
                    alert("Nouveau code : " + code);
                }

                socket.on('init_admin', d => {
                    document.getElementById('nb-oui').innerText = d.approved.length;
                    document.getElementById('autoCheck').checked = d.autoApprove;
                    document.getElementById('eventCodeInput').value = d.eventCode;
                    ['approved','trashed'].forEach(type => {
                        const l = document.getElementById('list-'+type); l.innerHTML = "";
                        d[type].forEach(p => {
                            const div = document.createElement('div');
                            div.innerHTML = '<img src="'+p.url+'" style="width:90px; height:60px; object-fit:cover; border-radius:5px;">';
                            l.appendChild(div);
                        });
                    });
                });
                
                socket.on('new_photo_pending', p => {
                    const l = document.getElementById('list-pending');
                    const div = document.createElement('div');
                    div.style = "background:white; padding:10px; border-radius:10px; width:120px; border:1px solid #007bff;";
                    div.innerHTML = '<img src="'+p.url+'" style="width:100%;"><button onclick="act(\\'/approve\\',\\''+p.url+'\\',\\''+p.user+'\\'); this.parentElement.remove()">OUI</button>';
                    l.prepend(div);
                });
                function act(r,u,usr) { fetch(r,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:u,user:usr})}); }
            </script>
        </body>
    \`);
});

// --- ROUTES ACTIONS ---
app.post('/set-event-code', isAdmin, (req, res) => { eventCode = req.body.code; saveDB(); res.sendStatus(200); });
app.post('/toggle-auto', isAdmin, (req, res) => { autoApprove = req.body.state; saveDB(); res.sendStatus(200); });
app.post('/upload', upload.single('photo'), (req, res) => {
    const data = { url: '/uploads/'+req.file.filename, user: req.body.username };
    if (autoApprove) { approvedPhotos.push(data); } else { io.emit('new_photo_pending', data); }
    saveDB(); res.sendStatus(200);
});

app.post('/approve', isAdmin, (req, res) => {
    approvedPhotos.push(req.body); saveDB(); io.emit('init_photos', {photos: approvedPhotos}); res.sendStatus(200);
});

app.get('/gallery', isPublic, (req, res) => {
    res.send(\`<body style="background:#121212;color:white;text-align:center;"><div id="grid"></div><script src="/socket.io/socket.io.js"></script><script>const socket=io();socket.on('init_photos',d=>{document.getElementById('grid').innerHTML=d.photos.map(p=>'<img src="'+p.url+'" style="width:100px;">').join('')})</script></body>\`);
});

server.listen(PORT, () => { console.log("🚀 Serveur prêt sur le port " + PORT); });
