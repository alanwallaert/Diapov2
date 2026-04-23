const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DB_FILE = './database.json';
const USERS_FILE = './users.json';

// --- INITIALISATION DES DOSSIERS ---
const publicPath = path.join(__dirname, 'public');
const uploadPath = path.join(publicPath, 'uploads');

if (!fs.existsSync(publicPath)) fs.mkdirSync(publicPath);
if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });

// Création du compte admin par défaut (1234)
if (!fs.existsSync(USERS_FILE)) {
    const hashed = bcrypt.hashSync("1234", 10);
    fs.writeFileSync(USERS_FILE, JSON.stringify([{ id: "admin", pass: hashed }]));
}

// --- VARIABLES D'ÉTAT ---
let approvedPhotos = [];
let slideDuration = 7000;

if (fs.existsSync(DB_FILE)) {
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE));
        approvedPhotos = data.approved || [];
        slideDuration = data.slideDuration || 7000;
    } catch(e) { console.log("Erreur lecture DB"); }
}

function saveDB() {
    fs.writeFileSync(DB_FILE, JSON.stringify({ approved: approvedPhotos, slideDuration }));
}

// --- CONFIGURATION EXPRESS ---
app.use(session({ secret: 'prestation-top-secret', resave: false, saveUninitialized: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(publicPath));
app.use('/uploads', express.static(uploadPath));

const upload = multer({ storage: multer.diskStorage({
    destination: uploadPath,
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
})});

// --- ROUTES AUTH ---
app.get('/login', (req, res) => {
    res.send(`
        <body style="font-family:sans-serif; background:#121212; color:white; display:flex; align-items:center; justify-content:center; height:100vh; margin:0;">
            <form action="/login" method="POST" style="background:#1e1e1e; padding:30px; border-radius:15px; width:280px; text-align:center;">
                <h2 style="color:#28a745;">Admin</h2>
                <input type="text" name="userid" placeholder="Identifiant" required style="width:100%; padding:12px; margin-bottom:10px; border-radius:8px; border:none; background:#333; color:white;">
                <input type="password" name="password" placeholder="Mot de passe" required style="width:100%; padding:12px; margin-bottom:20px; border-radius:8px; border:none; background:#333; color:white;">
                <button type="submit" style="width:100%; padding:12px; background:#28a745; color:white; border:none; border-radius:8px; cursor:pointer;">CONNEXION</button>
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

// --- ROUTE ADMIN ---
app.get('/admin', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    res.send(`
        <body style="font-family:sans-serif; background:#f0f2f5; padding:20px;">
            <div style="max-width:800px; margin:auto; background:white; padding:20px; border-radius:15px; box-shadow:0 4px 10px rgba(0,0,0,0.1);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                    <h1 style="margin:0;">🛡️ Gestion Photos</h1>
                    <a href="/logout" style="color:red; text-decoration:none; font-weight:bold;">Quitter</a>
                </div>
                <div style="background:#eee; padding:15px; border-radius:10px; margin-bottom:20px;">
                    Vitesse : <input type="range" min="2" max="15" value="${slideDuration/1000}" onchange="fetch('/set-duration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({duration:this.value*1000})})">
                </div>
                <div id="liste" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:15px;"></div>
            </div>
            <script src="/socket.io/socket.io.js"></script>
            <script>
                const socket = io();
                socket.on('init_photos', d => {
                    const div = document.getElementById('liste');
                    div.innerHTML = "";
                    d.photos.forEach(p => {
                        div.innerHTML += '<div style="position:relative; background:#f9f9f9; padding:5px; border-radius:10px;">' +
                            '<img src="'+p.url+'" style="width:100%; aspect-ratio:1/1; object-fit:cover; border-radius:8px;">' +
                            '<button onclick="del(\\''+p.url+'\\')" style="position:absolute; top:5px; right:5px; background:rgba(255,0,0,0.8); color:white; border:none; border-radius:50%; width:30px; height:30px; cursor:pointer;">X</button>' +
                        '</div>';
                    });
                });
                function del(url) { fetch('/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})}); }
            </script>
        </body>
    `);
});

app.post('/set-duration', (req, res) => { if(req.session.user) { slideDuration = req.body.duration; saveDB(); io.emit('init_photos', {photos:approvedPhotos, duration:slideDuration}); res.sendStatus(200); } });
app.post('/delete', (req, res) => { if(req.session.user) { approvedPhotos = approvedPhotos.filter(p => p.url !== req.body.url); saveDB(); io.emit('init_photos', {photos:approvedPhotos, duration:slideDuration}); res.sendStatus(200); } });

// --- ROUTE CLIENT ---
app.get('/', (req, res) => {
    res.send(`
        <body style="font-family:sans-serif; background:#121212; color:white; text-align:center; padding:20px;">
            <div style="max-width:400px; margin:auto; background:#1e1e1e; padding:30px; border-radius:20px;">
                <h2>📸 Envoi Photo</h2>
                <input type="text" id="user" placeholder="Votre Prénom" style="width:100%; padding:15px; margin-bottom:20px; border-radius:10px; border:none; background:#333; color:white; font-size:16px;">
                <input type="file" id="file" accept="image/*" style="display:none;" onchange="upload()">
                <button onclick="document.getElementById('file').click()" style="width:100%; padding:20px; background:#28a745; color:white; border:none; border-radius:15px; font-weight:bold; font-size:18px; cursor:pointer;">PRENDRE / CHOISIR PHOTO</button>
                <p id="msg" style="margin-top:20px; color:#28a745; font-weight:bold;"></p>
            </div>
            <script>
                async function upload() {
                    const u = document.getElementById('user').value;
                    const f = document.getElementById('file').files[0];
                    if(!u || !f) return alert("Prénom + Photo requis !");
                    const fd = new FormData(); fd.append('photo', f); fd.append('username', u);
                    document.getElementById('msg').innerText = "Envoi...";
                    await fetch('/upload', {method:'POST', body:fd});
                    document.getElementById('msg').innerText = "✅ Reçu ! Regardez l'écran !";
                    setTimeout(() => document.getElementById('msg').innerText = "", 4000);
                }
            </script>
        </body>
    `);
});

app.post('/upload', upload.single('photo'), (req, res) => {
    if (req.file) {
        approvedPhotos.push({ url: '/uploads/' + req.file.filename, user: req.body.username });
        saveDB();
        io.emit('init_photos', { photos: approvedPhotos, duration: slideDuration });
    }
    res.sendStatus(200);
});

// --- ROUTE DIAPORAMA ---
app.get('/retro', (req, res) => {
    res.send(`
        <body style="background:black; margin:0; overflow:hidden; display:flex; align-items:center; justify-content:center; height:100vh;">
            <div id="box" style="width:100%; height:100%; display:flex; align-items:center; justify-content:center;"></div>
            <script src="/socket.io/socket.io.js"></script>
            <script>
                const socket = io();
                let photos = []; let cur = 0; let t = null; let dur = 7000;
                socket.on('init_photos', d => { photos = d.photos; dur = d.duration; if(!t) start(); });
                function start() {
                    if(!photos.length) return setTimeout(start, 2000);
                    const box = document.getElementById('box');
                    const img = document.createElement('img');
                    img.src = photos[cur].url;
                    img.style.cssText = "max-width:100%; max-height:100%; object-fit:contain; opacity:0; transition:opacity 1s;";
                    box.innerHTML = "";
                    box.appendChild(img);
                    setTimeout(() => img.style.opacity = 1, 100);
                    cur = (cur + 1) % photos.length;
                    t = setTimeout(start, dur);
                }
            </script>
        </body>
    `);
});

io.on('connection', (socket) => {
    socket.emit('init_photos', { photos: approvedPhotos, duration: slideDuration });
});

server.listen(PORT, () => console.log("Lancement sur port " + PORT));
