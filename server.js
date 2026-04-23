const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
let approvedPhotos = []; 
let rejectedPhotos = []; 
let trashedPhotos = [];
let autoApprove = false;
let slideDuration = 2000; // Calqué sur ton image (2s)
let transitionType = "crossfade";

const publicPath = path.join(__dirname, 'public');
const uploadPath = path.join(publicPath, 'uploads');
if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });

app.use(express.json());
app.use(express.static(publicPath));

const upload = multer({ storage: multer.diskStorage({
    destination: uploadPath,
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
})});

// --- LOGIQUE SOCKET ---
function updateAdmin() {
    io.emit('init_admin', { approved: approvedPhotos, rejected: rejectedPhotos, trashed: trashedPhotos, autoApprove, slideDuration, transitionType });
}

io.on('connection', (socket) => {
    socket.emit('init_photos', { photos: approvedPhotos, duration: slideDuration, transitionType });
    updateAdmin();
});

// --- ROUTES API ---
app.post('/upload', upload.single('photo'), (req, res) => {
    const data = { url: '/uploads/' + req.file.filename, user: req.body.username || 'Anonyme' };
    if (autoApprove) { approvedPhotos.push(data); io.emit('init_photos', { photos: approvedPhotos, duration: slideDuration, transitionType }); }
    io.emit('new_photo_pending', data);
    res.sendStatus(200);
});

app.post('/action', (req, res) => {
    const { action, photo } = req.body;
    // Nettoyage
    approvedPhotos = approvedPhotos.filter(p => p.url !== photo.url);
    rejectedPhotos = rejectedPhotos.filter(p => p.url !== photo.url);
    
    if (action === 'approve') approvedPhotos.push(photo);
    if (action === 'reject') rejectedPhotos.push(photo);
    if (action === 'trash') trashedPhotos.push(photo);

    io.emit('init_photos', { photos: approvedPhotos, duration: slideDuration, transitionType });
    updateAdmin();
    res.sendStatus(200);
});

// --- PAGES ---

// 1. PAGE PUBLIC (2 Boutons : Photo et Album)
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>
    body { font-family:sans-serif; background:#121212; color:white; text-align:center; padding:20px; }
    .card { background:#1e1e1e; padding:30px; border-radius:20px; max-width:400px; margin:auto; box-shadow:0 10px 20px rgba(0,0,0,0.3); }
    .btn { display:block; width:100%; padding:20px; margin:10px 0; border-radius:12px; border:none; font-weight:bold; cursor:pointer; font-size:16px; }
    .btn-cam { background:#007bff; color:white; }
    .btn-gal { background:#6f42c1; color:white; }
    .btn-send { background:#28a745; color:white; display:none; }
    input[type="text"] { width:100%; padding:15px; border-radius:10px; border:none; background:#333; color:white; margin-bottom:15px; box-sizing:border-box; }
    </style></head><body>
    <div class="card">
        <h2>📸 Partagez</h2>
        <input type="text" id="user" placeholder="Votre Prénom">
        <label class="btn btn-cam">📷 PRENDRE UNE PHOTO <input type="file" accept="image/*" capture="camera" id="f1" style="display:none" onchange="preview(this)"></label>
        <label class="btn btn-gal">🖼️ DEPUIS L'ALBUM <input type="file" accept="image/*" id="f2" style="display:none" onchange="preview(this)"></label>
        <button id="send" class="btn btn-send" onclick="send()">🚀 ENVOYER MAINTENANT</button>
    </div>
    <script>
    let file;
    function preview(el){ file = el.files[0]; if(file){ document.getElementById('send').style.display='block'; } }
    async function send(){
        const u = document.getElementById('user').value || 'Anonyme';
        const fd = new FormData(); fd.append('photo', file); fd.append('username', u);
        await fetch('/upload', {method:'POST', body:fd}); alert('Envoyé !'); location.reload();
    }
    </script></body></html>`);
});

// 2. PAGE ADMIN (Design calqué sur ton image)
app.get('/admin', (req, res) => {
    res.send(`<!DOCTYPE html><html><head><style>
    body { font-family:sans-serif; background:#f4f7f9; margin:0; }
    .header { background:white; padding:15px 30px; display:flex; align-items:center; justify-content:space-between; box-shadow:0 2px 5px rgba(0,0,0,0.05); }
    .config-bar { display:flex; gap:20px; padding:15px 30px; background:#f4f7f9; }
    .config-item { background:white; padding:10px 20px; border-radius:8px; display:flex; align-items:center; gap:10px; box-shadow:0 2px 4px rgba(0,0,0,0.03); flex:1; }
    .tabs { padding:0 30px; display:flex; gap:10px; margin-top:20px; }
    .tab { padding:10px 20px; border-radius:8px; cursor:pointer; font-weight:bold; border:none; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:15px; padding:30px; }
    .photo-card { background:white; padding:10px; border-radius:10px; text-align:center; box-shadow:0 2px 5px rgba(0,0,0,0.1); }
    .photo-card img { width:100%; height:120px; object-fit:cover; border-radius:5px; }
    .btn-group { display:flex; gap:5px; margin-top:10px; }
    .btn-group button { flex:1; border:none; padding:5px; border-radius:4px; color:white; cursor:pointer; font-size:10px; }
    </style></head><body>
    <div class="header">
        <h2 style="margin:0; display:flex; align-items:center; gap:10px;">🛡️ Admin</h2>
        <div>
            <button style="padding:8px 15px; border:1px solid #ddd; background:white; border-radius:5px;">PHOTOS</button>
            <button style="padding:8px 15px; border:1px solid #ddd; background:white; border-radius:5px;">CONFIG</button>
            <button style="padding:8px 15px; background:#ff4757; color:white; border:none; border-radius:5px;">QUITTER</button>
        </div>
    </div>
    <div class="config-bar">
        <div class="config-item">AUTO: <input type="checkbox" id="auto"></div>
        <div class="config-item">TEMPS: <input type="number" id="dur" value="2" style="width:40px"> s</div>
        <div class="config-item">EFFET: <select id="eff"><option value="crossfade">Croisé</option></select></div>
    </div>
    <div class="tabs">
        <button class="tab" style="background:#007bff; color:white" onclick="show('wait')">ATTENTE</button>
        <button class="tab" style="background:#28a745; color:white" onclick="show('yes')">OUI</button>
        <button class="tab" style="background:#ffc107; color:black" onclick="show('no')">NON</button>
        <button class="tab" style="background:#333; color:white" onclick="show('trash')">POUBELLE</button>
    </div>
    <div id="container" class="grid"></div>
    <script src="/socket.io/socket.io.js"></script>
    <script>
    const socket = io();
    let currentTab = 'wait';
    let data = { approved:[], rejected:[], trashed:[] };
    let pending = [];

    function show(tab) { currentTab = tab; render(); }
    function act(action, photo) { fetch('/action', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action, photo})}); }

    socket.on('init_admin', d => { data = d; render(); });
    socket.on('new_photo_pending', p => { pending.push(p); render(); });

    function render() {
        const c = document.getElementById('container'); c.innerHTML = '';
        let list = [];
        if(currentTab === 'wait') list = pending;
        else if(currentTab === 'yes') list = data.approved;
        else if(currentTab === 'no') list = data.rejected;
        else list = data.trashed;

        list.forEach(p => {
            const div = document.createElement('div'); div.className = 'photo-card';
            div.innerHTML = '<img src="'+p.url+'"><div>'+p.user+'</div><div class="btn-group">' +
                '<button style="background:#28a745" onclick=\\'act("approve",'+JSON.stringify(p)+')\\'>OUI</button>' +
                '<button style="background:#ffc107" onclick=\\'act("reject",'+JSON.stringify(p)+')\\'>NON</button>' +
                '<button style="background:#333" onclick=\\'act("trash",'+JSON.stringify(p)+')\\'>🗑️</button></div>';
            c.appendChild(div);
        });
    }
    </script></body></html>`);
});

// 3. PAGE RETRO (Plein écran corrigé)
app.get('/retro', (req, res) => {
    res.send(`<!DOCTYPE html><html><body style="background:black; margin:0; overflow:hidden;">
    <div id="overlay" style="position:fixed; inset:0; z-index:10; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.8); color:white; font-family:sans-serif;">
        <button onclick="start()" style="padding:20px 40px; font-size:20px; cursor:pointer; border-radius:50px; border:none; background:#28a745; color:white;">Lancer le Plein Écran</button>
    </div>
    <div id="slide" style="width:100vw; height:100vh; display:flex; align-items:center; justify-content:center;">
        <img id="img" style="max-width:100%; max-height:100%; transition: opacity 1s; opacity:0;">
    </div>
    <script src="/socket.io/socket.io.js"></script>
    <script>
    const socket = io();
    let photos = [], cur = 0;
    
    function start() {
        document.getElementById('overlay').style.display = 'none';
        const el = document.documentElement;
        if (el.requestFullscreen) el.requestFullscreen();
        setInterval(next, 3000);
    }
    
    function next() {
        if(!photos.length) return;
        const img = document.getElementById('img');
        img.style.opacity = 0;
        setTimeout(() => {
            img.src = photos[cur].url;
            img.style.opacity = 1;
            cur = (cur + 1) % photos.length;
        }, 1000);
    }
    socket.on('init_photos', d => { photos = d.photos; });
    </script></body></html>`);
});

server.listen(PORT, () => console.log('Prêt : port ' + PORT));
