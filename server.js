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

// --- DOSSIERS ---
const publicPath = path.join(__dirname, 'public');
const uploadPath = path.join(publicPath, 'uploads');

if (!fs.existsSync(publicPath)) fs.mkdirSync(publicPath);
if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });

// --- ÉTAT ---
let approvedPhotos = [];
let autoApprove = false;
let slideDuration = 7000;
let transitionEffect = "fade";

if (fs.existsSync(DB_FILE)) {
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE));
        approvedPhotos = data.approved || [];
        autoApprove = data.autoApprove || false;
        slideDuration = data.slideDuration || 7000;
        transitionEffect = data.transitionEffect || "fade";
    } catch(e) {}
}

function save() {
    fs.writeFileSync(DB_FILE, JSON.stringify({ approved: approvedPhotos, autoApprove, slideDuration, transitionEffect }));
    io.emit('init_photos', { photos: approvedPhotos, duration: slideDuration, effect: transitionEffect });
    io.emit('init_admin', { approved: approvedPhotos, autoApprove, slideDuration, transitionEffect });
}

// --- MIDDLEWARES ---
app.use(session({ secret: 'diapo-key', resave: false, saveUninitialized: true }));
app.use(express.json());
app.use(express.static(publicPath));
// LIGNE CRUCIALE : On expose explicitement le dossier uploads
app.use('/uploads', express.static(uploadPath));

const upload = multer({ storage: multer.diskStorage({
    destination: uploadPath,
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
})});

// --- ROUTES ---
app.get('/login', (req, res) => {
    res.send(`<body style="background:#f0f2f5;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;">
        <form action="/login" method="POST" style="background:white;padding:30px;border-radius:15px;box-shadow:0 10px 25px rgba(0,0,0,0.1);">
            <h2>Admin Login</h2>
            <input type="password" name="password" placeholder="Mot de passe" style="padding:10px;width:200px;"><br><br>
            <button type="submit" style="width:100%;padding:10px;background:#28a745;color:white;border:none;border-radius:5px;cursor:pointer;">Entrer</button>
        </form></body>`);
});

app.post('/login', (req, res) => {
    if (req.body.password === "1234") { req.session.user = "admin"; res.redirect('/admin'); }
    else res.send("Raté");
});

app.get('/admin', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    res.send(`
    <style>
        body { font-family: sans-serif; background: #f0f2f5; margin: 0; padding: 20px; }
        .card { background: white; padding: 20px; border-radius: 15px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); margin-bottom: 20px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 15px; }
        .photo { position: relative; background: #eee; border-radius: 10px; overflow: hidden; height: 150px; }
        .photo img { width: 100%; height: 100%; object-fit: cover; }
        .del-btn { position: absolute; bottom: 0; width: 100%; background: rgba(0,0,0,0.7); color: white; border: none; padding: 5px; cursor: pointer; }
        .nav { display: flex; gap: 10px; margin-bottom: 20px; }
        .btn { padding: 10px 20px; border-radius: 8px; border: none; cursor: pointer; font-weight: bold; background: #444; color: white; }
    </style>
    <body>
        <div class="nav">
            <button class="btn" onclick="show('photos')">PHOTOS</button>
            <button class="btn" onclick="show('sys')">SYSTÈME</button>
            <button class="btn" style="background:#dc3545" onclick="location.href='/logout'">QUITTER</button>
        </div>

        <div id="sec-photos" class="card">
            <div style="display:flex; justify-content:space-between; margin-bottom:20px;">
                <b>🚀 AUTO-APPROUVER : <input type="checkbox" id="auto" onchange="act('/set-auto', {val:this.checked})"></b>
                <b>⏱️ VITESSE : <input type="range" min="2" max="15" id="vitesse" onchange="act('/set-dur', {val:this.value*1000})"></b>
            </div>
            <div id="liste" class="grid"></div>
        </div>

        <div id="sec-sys" class="card" style="display:none">
            <h3>EFFET DE TRANSITION</h3>
            <select id="effet" onchange="act('/set-eff', {val:this.value})" style="width:100%; padding:10px;">
                <option value="fade">FONDU ENCHAÎNÉ</option>
                <option value="zoom">ZOOM (KEN BURNS)</option>
                <option value="slide">GLISSEMENT</option>
            </select>
        </div>

        <script src="/socket.io/socket.io.js"></script>
        <script>
            const socket = io();
            function show(id) { 
                document.getElementById('sec-photos').style.display = id==='photos'?'block':'none';
                document.getElementById('sec-sys').style.display = id==='sys'?'block':'none';
            }
            function act(route, data) { fetch(route, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)}); }
            
            socket.on('init_admin', d => {
                document.getElementById('auto').checked = d.autoApprove;
                document.getElementById('vitesse').value = d.slideDuration/1000;
                document.getElementById('effet').value = d.transitionEffect;
                const div = document.getElementById('liste');
                div.innerHTML = "";
                d.approved.forEach(p => {
                    div.innerHTML += '<div class="photo"><img src="'+p.url+'"><button class="del-btn" onclick="act(\\'/del\\',{url:\\''+p.url+'\\'})">🗑️ SUPPRIMER</button></div>';
                });
            });
        </script>
    </body>`);
});

// --- ACTIONS API ---
app.post('/set-auto', (req, res) => { autoApprove = req.body.val; save(); res.sendStatus(200); });
app.post('/set-dur', (req, res) => { slideDuration = req.body.val; save(); res.sendStatus(200); });
app.post('/set-eff', (req, res) => { transitionEffect = req.body.val; save(); res.sendStatus(200); });
app.post('/del', (req, res) => { approvedPhotos = approvedPhotos.filter(p => p.url !== req.body.url); save(); res.sendStatus(200); });

app.post('/upload', upload.single('photo'), (req, res) => {
    // IMPORTANT : On s'assure que l'URL commence bien par /uploads/
    const data = { url: '/uploads/' + req.file.filename, user: req.body.username || "Anonyme" };
    approvedPhotos.push(data);
    save();
    res.sendStatus(200);
});

// --- DIAPORAMA ---
app.get('/retro', (req, res) => {
    res.send(`
    <style>
        body { background: black; margin: 0; overflow: hidden; display: flex; align-items: center; justify-content: center; height: 100vh; }
        img { position: absolute; max-width: 100%; max-height: 100%; object-fit: contain; opacity: 0; transition: opacity 1.5s ease-in-out; }
        .active { opacity: 1; }
        .zoom.active { transform: scale(1.1); transition: opacity 1.5s, transform 10s linear; }
    </style>
    <div id="container"></div>
    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io(); let list = []; let cur = 0; let dur = 7000; let eff = "fade";
        socket.on('init_photos', d => { list = d.photos; dur = d.duration; eff = d.effect; });
        
        function next() {
            if(!list.length) return;
            const container = document.getElementById('container');
            const img = document.createElement('img');
            img.src = list[cur].url;
            img.className = eff;
            container.innerHTML = "";
            container.appendChild(img);
            setTimeout(() => img.classList.add('active'), 100);
            cur = (cur + 1) % list.length;
            setTimeout(next, dur);
        }
        next();
    </script>`);
});

// --- PAGE D'ENVOI ---
app.get('/', (req, res) => {
    res.send(`
    <body style="background:#121212; color:white; font-family:sans-serif; text-align:center; padding:20px;">
        <h2>📸 PARTAGEZ VOS PHOTOS</h2>
        <input type="text" id="name" placeholder="Votre prénom" style="padding:15px; width:80%; border-radius:10px; border:none; margin-bottom:20px;">
        <input type="file" id="file" accept="image/*" style="display:none" onchange="upload()">
        <button onclick="document.getElementById('file').click()" style="padding:20px; width:80%; background:#28a745; color:white; border:none; border-radius:10px; font-weight:bold;">ENVOYER UNE PHOTO</button>
        <script>
            async function upload() {
                const fd = new FormData();
                fd.append('photo', document.getElementById('file').files[0]);
                fd.append('username', document.getElementById('name').value);
                await fetch('/upload', { method:'POST', body:fd });
                alert('Photo reçue ! Merci.');
            }
        </script>
    </body>`);
});

server.listen(PORT, () => {
    console.log("Serveur OK sur port " + PORT);
    // Ping pour éviter la mise en veille de Render
    setInterval(() => { http.get('http://localhost:'+PORT); }, 840000);
});
