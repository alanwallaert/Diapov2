const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const session = require('express-session');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DB_FILE = '/tmp/database.json'; // Utilisation du dossier /tmp pour Render

// --- DOSSIERS ---
const uploadPath = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });

// --- ÉTAT ---
let photos = [];
let slideDuration = 7000;
let effect = "fade";

// Chargement
if (fs.existsSync(DB_FILE)) {
    try { photos = JSON.parse(fs.readFileSync(DB_FILE)); } catch(e) {}
}

function update() {
    fs.writeFileSync(DB_FILE, JSON.stringify(photos));
    io.emit('data', { photos, slideDuration, effect });
}

// --- CONFIG ---
app.use(session({ secret: 'diapo123', resave: false, saveUninitialized: true }));
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(uploadPath));

const upload = multer({ storage: multer.diskStorage({
    destination: uploadPath,
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
})});

// --- ROUTES ---
app.post('/login', (req, res) => {
    if (req.body.password === "1234") { req.session.user = true; res.json({ok:true}); }
    else res.json({ok:false});
});

app.get('/admin-data', (req, res) => {
    if (!req.session.user) return res.status(401).send();
    res.json({ photos, slideDuration, effect });
});

app.post('/upload', upload.single('photo'), (req, res) => {
    if (req.file) {
        photos.push({ url: '/uploads/' + req.file.filename, user: req.body.username || "Anonyme" });
        update();
    }
    res.sendStatus(200);
});

app.post('/delete', (req, res) => {
    if (!req.session.user) return res.status(401).send();
    photos = photos.filter(p => p.url !== req.body.url);
    update();
    res.sendStatus(200);
});

app.post('/config', (req, res) => {
    if (!req.session.user) return res.status(401).send();
    if (req.body.duration) slideDuration = req.body.duration;
    if (req.body.effect) effect = req.body.effect;
    update();
    res.sendStatus(200);
});

// --- PAGES HTML (Injectées pour éviter les fichiers manquants) ---
app.get('/login', (req, res) => {
    res.send(`<body style="background:#121212;color:white;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;">
        <div style="text-align:center;">
            <h2>Admin Login</h2>
            <input type="password" id="pw" style="padding:10px;border-radius:5px;"><br><br>
            <button onclick="login()" style="padding:10px 20px;background:#28a745;color:white;border:none;border-radius:5px;cursor:pointer;">Entrer</button>
        </div>
        <script>
            async function login(){
                const res = await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.getElementById('pw').value})});
                const d = await res.json(); if(d.ok) location.href='/admin'; else alert('Faux !');
            }
        </script></body>`);
});

app.get('/admin', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    res.send(`
    <body style="background:#f0f2f5;font-family:sans-serif;padding:20px;">
        <div style="max-width:800px;margin:auto;background:white;padding:20px;border-radius:15px;box-shadow:0 2px 10px rgba(0,0,0,0.1);">
            <h2>⚙️ Configuration</h2>
            Vitesse: <input type="range" min="2000" max="15000" step="1000" onchange="fetch('/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({duration:parseInt(this.value)})})"><br>
            Effet: <select onchange="fetch('/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({effect:this.value})})">
                <option value="fade">Fondu</option><option value="zoom">Zoom</option><option value="slide">Glissement</option>
            </select>
            <hr>
            <div id="list" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:10px;"></div>
        </div>
        <script src="/socket.io/socket.io.js"></script>
        <script>
            const socket = io();
            socket.on('data', d => {
                const l = document.getElementById('list'); l.innerHTML = "";
                d.photos.forEach(p => {
                    l.innerHTML += '<div style="position:relative;"><img src="'+p.url+'" style="width:100%;border-radius:5px;"><button onclick="fetch(\\'/delete\\',{method:\\'POST\\',headers:{\\'Content-Type\\':\\'application/json\\'},body:JSON.stringify({url:\\''+p.url+'\\'})})" style="position:absolute;top:0;right:0;background:red;color:white;border:none;cursor:pointer;">X</button></div>';
                });
            });
            fetch('/admin-data').then(r=>r.json()).then(d=>socket.emit('data',d));
        </script>
    </body>`);
});

app.get('/retro', (req, res) => {
    res.send(`
    <style>
        body { background:black; margin:0; overflow:hidden; display:flex; align-items:center; justify-content:center; height:100vh; }
        .s { position:absolute; max-width:100%; max-height:100%; opacity:0; transition: opacity 1s; }
        .active { opacity:1; }
        .zoom.active { transform: scale(1.1); transition: opacity 1s, transform 10s linear; }
    </style>
    <div id="box"></div>
    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io(); let list = []; let cur = 0; let dur = 7000; let eff = "fade";
        socket.on('data', d => { list = d.photos; dur = d.slideDuration; eff = d.effect; });
        function play() {
            if(!list.length) return setTimeout(play, 2000);
            const box = document.getElementById('box');
            const img = document.createElement('img');
            img.src = list[cur].url; img.className = 's ' + eff;
            box.innerHTML = ""; box.appendChild(img);
            setTimeout(() => img.classList.add('active'), 50);
            cur = (cur + 1) % list.length;
            setTimeout(play, dur);
        }
        play();
    </script>`);
});

server.listen(PORT, () => console.log("OK"));
