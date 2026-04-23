const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// --- STOCKAGE DES PHOTOS ---
let approvedPhotos = []; 
let rejectedPhotos = []; 
let trashedPhotos = [];
let pendingPhotos = []; // Photos en attente de validation
let autoApprove = false;
let slideDuration = 2000;

const uploadPath = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });

app.use(express.json());
app.use(express.static('public'));

const upload = multer({ storage: multer.diskStorage({
    destination: uploadPath,
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
})});

// --- LOGIQUE SOCKET ---
function sendAdminUpdate() {
    io.emit('init_admin', { 
        approved: approvedPhotos, 
        rejected: rejectedPhotos, 
        trashed: trashedPhotos, 
        pending: pendingPhotos,
        autoApprove, 
        slideDuration 
    });
}

io.on('connection', (socket) => {
    socket.emit('init_photos', { photos: approvedPhotos, duration: slideDuration });
    sendAdminUpdate();
});

// --- ROUTES ---

// Upload depuis le téléphone
app.post('/upload', upload.single('photo'), (req, res) => {
    const data = { url: '/uploads/' + req.file.filename, user: req.body.username || 'Anonyme' };
    if (autoApprove) {
        approvedPhotos.push(data);
        io.emit('init_photos', { photos: approvedPhotos, duration: slideDuration });
    } else {
        pendingPhotos.push(data);
    }
    sendAdminUpdate();
    res.sendStatus(200);
});

// Actions Admin (Approuver, Rejeter, Poubelle)
app.post('/action', (req, res) => {
    const { action, photo } = req.body;
    // On retire la photo de toutes les listes d'abord
    pendingPhotos = pendingPhotos.filter(p => p.url !== photo.url);
    approvedPhotos = approvedPhotos.filter(p => p.url !== photo.url);
    rejectedPhotos = rejectedPhotos.filter(p => p.url !== photo.url);
    trashedPhotos = trashedPhotos.filter(p => p.url !== photo.url);
    
    if (action === 'approve') approvedPhotos.push(photo);
    if (action === 'reject') rejectedPhotos.push(photo);
    if (action === 'trash') trashedPhotos.push(photo);

    io.emit('init_photos', { photos: approvedPhotos, duration: slideDuration });
    sendAdminUpdate();
    res.sendStatus(200);
});

// --- PAGES HTML ---

// PAGE PUBLIC
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>
    body { font-family:sans-serif; background:#121212; color:white; text-align:center; padding:20px; }
    .btn { display:block; width:100%; padding:20px; margin:10px 0; border-radius:15px; border:none; font-weight:bold; cursor:pointer; font-size:18px; }
    .btn-photo { background:#007bff; color:white; }
    .btn-album { background:#6f42c1; color:white; }
    .btn-send { background:#28a745; color:white; display:none; }
    input { width:100%; padding:15px; border-radius:10px; border:none; margin-bottom:15px; box-sizing:border-box; }
    </style></head><body>
    <h2>📸 Partage Photo</h2>
    <input type="text" id="user" placeholder="Ton Prénom">
    <label class="btn btn-photo">📷 PRENDRE UNE PHOTO <input type="file" accept="image/*" capture="camera" style="display:none" onchange="preview(this)"></label>
    <label class="btn btn-album">🖼️ DEPUIS L'ALBUM <input type="file" accept="image/*" style="display:none" onchange="preview(this)"></label>
    <button id="send" class="btn btn-send" onclick="send()">🚀 ENVOYER</button>
    <script>
    let file;
    function preview(el){ file = el.files[0]; if(file) document.getElementById('send').style.display='block'; }
    async function send(){
        const fd = new FormData(); fd.append('photo', file); fd.append('username', document.getElementById('user').value);
        await fetch('/upload', {method:'POST', body:fd}); alert('Envoyé !'); location.reload();
    }
    </script></body></html>`);
});

// PAGE ADMIN (AVEC COULEURS ET DESIGN IMAGE)
app.get('/admin', (req, res) => {
    res.send(`<!DOCTYPE html><html><head><style>
    body { font-family:sans-serif; background:#f4f7f9; margin:0; }
    .header { background:white; padding:15px; display:flex; justify-content:space-between; align-items:center; box-shadow:0 2px 10px rgba(0,0,0,0.1); }
    .config { display:flex; gap:10px; padding:15px; background:#e9ecef; }
    .card-config { background:white; padding:10px; border-radius:8px; flex:1; text-align:center; font-weight:bold; }
    .tabs { display:flex; padding:10px; gap:5px; }
    .tab { flex:1; padding:15px; border:none; border-radius:8px; color:white; font-weight:bold; cursor:pointer; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); gap:10px; padding:10px; }
    .p-card { background:white; padding:8px; border-radius:10px; text-align:center; box-shadow:0 2px 5px rgba(0,0,0,0.1); }
    .p-card img { width:100%; height:100px; object-fit:cover; border-radius:5px; }
    .btns { display:flex; gap:3px; margin-top:8px; }
    .btns button { flex:1; border:none; padding:8px 0; border-radius:4px; color:white; cursor:pointer; font-size:10px; font-weight:bold; }
    </style></head><body>
    <div class="header">
        <h2 style="margin:0">🛡️ Admin Control</h2>
        <button style="background:#dc3545; color:white; border:none; padding:10px; border-radius:5px;">QUITTER</button>
    </div>
    <div class="config">
        <div class="card-config">AUTO: <input type="checkbox" id="auto"></div>
        <div class="card-config">TEMPS: <input type="number" id="dur" value="2" style="width:40px">s</div>
        <div class="card-config">EFFET: Croisé</div>
    </div>
    <div class="tabs">
        <button class="tab" style="background:#007bff" onclick="curr='pending';render()">ATTENTE</button>
        <button class="tab" style="background:#28a745" onclick="curr='approved';render()">OUI</button>
        <button class="tab" style="background:#ffc107; color:black" onclick="curr='rejected';render()">NON</button>
        <button class="tab" style="background:#343a40" onclick="curr='trashed';render()">POUBELLE</button>
    </div>
    <div id="grid" class="grid"></div>
    <script src="/socket.io/socket.io.js"></script>
    <script>
    const socket = io();
    let curr = 'pending';
    let state = {};
    function act(action, photo) { fetch('/action', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action, photo})}); }
    socket.on('init_admin', d => { state = d; render(); });
    function render() {
        const g = document.getElementById('grid'); g.innerHTML = '';
        const list = state[curr] || [];
        list.forEach(p => {
            const div = document.createElement('div'); div.className = 'p-card';
            div.innerHTML = '<img src="'+p.url+'"><div>'+p.user+'</div><div class="btns">' +
                '<button style="background:#28a745" onclick=\\'act("approve",'+JSON.stringify(p)+')\\'>OUI</button>' +
                '<button style="background:#ffc107; color:black" onclick=\\'act("reject",'+JSON.stringify(p)+')\\'>NON</button>' +
                '<button style="background:#343a40" onclick=\\'act("trash",'+JSON.stringify(p)+')\\'>🗑️</button></div>';
            g.appendChild(div);
        });
    }
    </script></body></html>`);
});

// PAGE RÉTRO (Plein écran corrigé)
app.get('/retro', (req, res) => {
    res.send(`<!DOCTYPE html><html><body style="background:black; margin:0; overflow:hidden;">
    <div id="start" style="position:fixed; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.9); z-index:100;">
        <button onclick="go()" style="padding:20px 40px; font-size:20px; background:#28a745; color:white; border:none; border-radius:50px; cursor:pointer;">LANCER LE PLEIN ÉCRAN</button>
    </div>
    <img id="img" style="width:100vw; height:100vh; object-fit:contain; transition:opacity 1s; opacity:0;">
    <script src="/socket.io/socket.io.js"></script>
    <script>
    const socket = io(); let photos = [], cur = 0;
    function go() { 
        document.getElementById('start').style.display='none'; 
        document.documentElement.requestFullscreen();
        setInterval(next, 3000); 
    }
    function next() {
        if(!photos.length) return;
        const i = document.getElementById('img');
        i.style.opacity = 0;
        setTimeout(() => { i.src = photos[cur].url; i.style.opacity = 1; cur = (cur+1)%photos.length; }, 1000);
    }
    socket.on('init_photos', d => { photos = d.photos; });
    </script></body></html>`);
});

server.listen(PORT, () => console.log('Lien : http://localhost:' + PORT));
