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

// --- CONFIG & DATA ---
const PORT = 3000;
let approvedPhotos = []; 
let rejectedPhotos = []; 
let trashedPhotos = [];
let autoApprove = false;
let slideDuration = 7000;
let transitionType = "crossfade";

// Dossiers
const publicPath = path.join(__dirname, 'public');
const uploadPath = path.join(publicPath, 'uploads');
if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });

app.use(session({ secret: 'event-top-secret', resave: false, saveUninitialized: true }));
app.use(express.json());
app.use(express.static(publicPath));
const upload = multer({ storage: multer.diskStorage({
    destination: uploadPath,
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
})});

// --- SOCKETS ---
io.on('connection', (socket) => {
    refreshAdmin();
    io.emit('init_photos', { photos: approvedPhotos, duration: slideDuration, transitionType });
});

function refreshAdmin() {
    io.emit('init_admin', { approved: approvedPhotos, rejected: rejectedPhotos, trashed: trashedPhotos, autoApprove });
}

// --- ROUTES ADMIN ACTIONS ---
app.post('/approve', (req, res) => {
    const p = req.body;
    rejectedPhotos = rejectedPhotos.filter(x => x.url !== p.url);
    if(!approvedPhotos.find(x => x.url === p.url)) approvedPhotos.push(p);
    io.emit('init_photos', { photos: approvedPhotos, duration: slideDuration, transitionType });
    refreshAdmin(); res.sendStatus(200);
});

app.post('/reject', (req, res) => {
    const p = req.body;
    approvedPhotos = approvedPhotos.filter(x => x.url !== p.url);
    if(!rejectedPhotos.find(x => x.url === p.url)) rejectedPhotos.push(p);
    io.emit('init_photos', { photos: approvedPhotos, duration: slideDuration, transitionType });
    refreshAdmin(); res.sendStatus(200);
});

app.post('/trash', (req, res) => {
    const p = req.body;
    approvedPhotos = approvedPhotos.filter(x => x.url !== p.url);
    rejectedPhotos = rejectedPhotos.filter(x => x.url !== p.url);
    trashedPhotos.push(p);
    refreshAdmin(); res.sendStatus(200);
});

// --- PAGE PUBLIC (Index) ---
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: sans-serif; background: #121212; color: white; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .card { background: #1e1e1e; padding: 30px; border-radius: 25px; width: 85%; max-width: 400px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
        input { width: 100%; padding: 15px; border-radius: 12px; border: none; background: #333; color: white; margin-bottom: 20px; box-sizing: border-box; font-size: 16px; }
        .btn { display: block; width: 100%; padding: 20px; border-radius: 15px; border: none; font-weight: bold; font-size: 18px; cursor: pointer; margin-bottom: 15px; transition: 0.3s; text-decoration: none; }
        .btn-photo { background: #007bff; color: white; }
        .btn-album { background: #6f42c1; color: white; }
        .btn-send { background: #28a745; color: white; display: none; }
    </style></head>
    <body>
        <div class="card">
            <h2 style="margin-bottom:25px;">📸 Partagez vos souvenirs</h2>
            <input type="text" id="user" placeholder="Votre Prénom" oninput="check()">
            
            <label id="lbl-photo" class="btn btn-photo">📷 PRENDRE UNE PHOTO
                <input type="file" id="f" accept="image/*" style="display:none;" onchange="ready()">
            </label>

            <label id="lbl-album" class="btn btn-album">🖼️ DEPUIS L'ALBUM
                <input type="file" id="f2" accept="image/*" style="display:none;" onchange="ready(true)">
            </label>

            <button id="sendBtn" class="btn btn-send" onclick="upload()">🚀 ENVOYER LA PHOTO</button>
            
            <a href="/gallery" style="color: #888; text-decoration: none; font-size: 14px;">Voir la galerie live</a>
        </div>
        <script>
            let selectedFile = null;
            function check() { localStorage.setItem('p_name', document.getElementById('user').value); }
            function ready(isAlbum) {
                selectedFile = isAlbum ? document.getElementById('f2').files[0] : document.getElementById('f').files[0];
                if(selectedFile) {
                    document.getElementById('lbl-photo').style.display = 'none';
                    document.getElementById('lbl-album').style.display = 'none';
                    document.getElementById('sendBtn').style.display = 'block';
                }
            }
            async function upload() {
                const u = document.getElementById('user').value;
                if(!u) return alert('Entre ton prénom !');
                const fd = new FormData(); fd.append('photo', selectedFile); fd.append('username', u);
                await fetch('/upload', {method:'POST', body:fd});
                alert('Photo envoyée !'); location.reload();
            }
            document.getElementById('user').value = localStorage.getItem('p_name') || '';
        </script></body></html>`);
});

// --- PAGE ADMIN ---
app.get('/admin', (req, res) => {
    res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: sans-serif; background: #f0f2f5; margin: 0; padding: 10px; }
        .nav { display: flex; gap: 5px; margin-bottom: 15px; position: sticky; top: 0; background: #f0f2f5; padding: 5px; z-index: 10; }
        .nav button { flex: 1; padding: 12px; border: none; border-radius: 10px; font-weight: bold; cursor: pointer; color: white; }
        #btn-wait { background: #007bff; }
        #btn-yes { background: #28a745; }
        #btn-no { background: #ffc107; color: black; }
        #btn-trash { background: #dc3545; }
        .grid { display: flex; flex-wrap: wrap; gap: 10px; }
        .item { background: white; padding: 10px; border-radius: 12px; width: calc(50% - 15px); box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
        .item img { width: 100%; border-radius: 8px; height: 120px; object-fit: cover; }
        .actions { display: flex; gap: 5px; margin-top: 10px; }
        .actions button { flex: 1; padding: 8px; border: none; border-radius: 5px; color: white; cursor: pointer; font-size: 11px; }
    </style></head>
    <body>
        <div class="nav">
            <button id="btn-wait" onclick="show('wait')">ATTENTE</button>
            <button id="btn-yes" onclick="show('yes')">OUI</button>
            <button id="btn-no" onclick="show('no')">NON</button>
            <button id="btn-trash" onclick="show('trash')">🗑️</button>
        </div>

        <div id="sec-wait" class="grid"></div>
        <div id="sec-yes" class="grid" style="display:none"></div>
        <div id="sec-no" class="grid" style="display:none"></div>
        <div id="sec-trash" class="grid" style="display:none"></div>

        <script src="/socket.io/socket.io.js"></script>
        <script>
            const socket = io();
            function show(id) {
                ['wait','yes','no','trash'].forEach(s => document.getElementById('sec-'+s).style.display = s===id ? 'flex' : 'none');
            }
            function act(route, url, user) { fetch('/'+route, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url, user})}); }
            
            socket.on('init_admin', d => {
                render('sec-yes', d.approved, 'reject', 'NON', 'trash', '🗑️');
                render('sec-no', d.rejected, 'approve', 'OUI', 'trash', '🗑️');
                render('sec-trash', d.trashed, 'approve', 'RÉTABLIR', '', '');
            });

            socket.on('new_photo_pending', p => {
                const div = document.createElement('div'); div.className = 'item';
                div.innerHTML = '<img src="'+p.url+'"><b>'+p.user+'</b><div class="actions">' +
                    '<button style="background:green" onclick="act(\\'approve\\',\\''+p.url+'\\',\\''+p.user+'\\');this.closest(\\'div\\').parentElement.remove()">OUI</button>' +
                    '<button style="background:orange" onclick="act(\\'reject\\',\\''+p.url+'\\',\\''+p.user+'\\');this.closest(\\'div\\').parentElement.remove()">NON</button></div>';
                document.getElementById('sec-wait').prepend(div);
            });

            function render(id, list, r1, t1, r2, t2) {
                const container = document.getElementById(id); container.innerHTML = '';
                list.forEach(p => {
                    const div = document.createElement('div'); div.className = 'item';
                    div.innerHTML = '<img src="'+p.url+'"><b>'+p.user+'</b><div class="actions">' +
                        '<button style="background:#28a745" onclick="act(\\'approve\\',\\''+p.url+'\\',\\''+p.user+'\\')">OUI</button>' +
                        '<button style="background:#ffc107" onclick="act(\\'reject\\',\\''+p.url+'\\',\\''+p.user+'\\')">NON</button>' +
                        '<button style="background:#dc3545" onclick="act(\\'trash\\',\\''+p.url+'\\',\\''+p.user+'\\')">🗑️</button></div>';
                    container.appendChild(div);
                });
            }
        </script></body></html>`);
});

// --- PAGE RETRO (Correction Plein Écran) ---
app.get('/retro', (req, res) => {
    res.send(`<!DOCTYPE html><html><body style="background:black;margin:0;overflow:hidden;font-family:sans-serif;">
    <div id="startScreen" style="position:fixed;inset:0;background:rgba(0,0,0,0.8);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:100;color:white;">
        <button onclick="startRetro()" style="padding:20px 40px;font-size:24px;border-radius:50px;background:#28a745;color:white;border:none;cursor:pointer;">LANCER LE DIAPORAMA PLEIN ÉCRAN</button>
        <p>Cliquez pour activer le mode immersif</p>
    </div>
    <div id="container" style="width:100vw;height:100vh;position:relative;">
        <img id="img1" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;transition:opacity 1.5s;opacity:0;">
        <img id="img2" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;transition:opacity 1.5s;opacity:0;">
    </div>
    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        let list = [], cur = 0, active = 1;

        function startRetro() {
            document.getElementById('startScreen').style.display = 'none';
            // Tentative de plein écran
            const elem = document.documentElement;
            if (elem.requestFullscreen) elem.requestFullscreen();
            else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
            
            setInterval(next, 7000);
            next();
        }

        function next() {
            if(!list.length) return;
            const i1 = document.getElementById('img1'), i2 = document.getElementById('img2');
            const show = active === 1 ? i1 : i2;
            const hide = active === 1 ? i2 : i1;
            show.src = list[cur].url;
            show.style.opacity = 1;
            hide.style.opacity = 0;
            cur = (cur + 1) % list.length;
            active = active === 1 ? 2 : 1;
        }

        socket.on('init_photos', d => { list = d.photos; });
    </script></body></html>`);
});

// --- UPLOAD HANDLER ---
app.post('/upload', upload.single('photo'), (req, res) => {
    const data = { url: '/uploads/'+req.file.filename, user: req.body.username };
    io.emit('new_photo_pending', data);
    res.sendStatus(200);
});

server.listen(PORT, () => console.log('Serveur : http://localhost:'+PORT));
