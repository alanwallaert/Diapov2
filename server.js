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

// --- DATA ---
let photos = { pending: [], approved: [], rejected: [], trashed: [] };
let config = { auto: false, duration: 2, transition: 'crossfade' };

const uploadPath = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });

app.use(express.json());
app.use(express.static('public'));

const upload = multer({ storage: multer.diskStorage({
    destination: uploadPath,
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
})});

// --- SOCKETS ---
function sync() {
    io.emit('admin_update', { photos, config });
    io.emit('init_photos', { approved: photos.approved, config });
}

io.on('connection', (socket) => sync());

// --- ROUTES API ---
app.post('/upload', upload.single('photo'), (req, res) => {
    const item = { url: '/uploads/' + req.file.filename, user: req.body.username || 'Anonyme', id: Date.now() };
    if (config.auto) photos.approved.push(item);
    else photos.pending.push(item);
    sync();
    res.sendStatus(200);
});

app.post('/action', (req, res) => {
    const { action, item } = req.body;
    // Nettoyage partout
    for (let key in photos) photos[key] = photos[key].filter(p => p.id !== item.id);
    // Ajout dans la bonne catégorie
    if (action === 'approve') photos.approved.push(item);
    if (action === 'reject') photos.rejected.push(item);
    if (action === 'trash') photos.trashed.push(item);
    sync();
    res.sendStatus(200);
});

app.post('/config', (req, res) => {
    config = { ...config, ...req.body };
    sync();
    res.sendStatus(200);
});

// --- PAGES ---

// 1. PUBLIC (Boutons séparés)
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: sans-serif; background: #121212; color: white; text-align: center; padding: 20px; }
        .btn { display: block; width: 100%; padding: 20px; margin: 15px 0; border-radius: 12px; border: none; font-weight: bold; font-size: 18px; cursor: pointer; }
        .cam { background: #007bff; color: white; }
        .gal { background: #6f42c1; color: white; }
        .send { background: #28a745; color: white; display: none; border: 4px solid white; }
        input { width: 100%; padding: 15px; border-radius: 10px; border: none; margin-bottom: 10px; box-sizing: border-box; }
    </style></head><body>
        <h2>📸 Partage Photo</h2>
        <input type="text" id="u" placeholder="Ton Prénom">
        <label class="btn cam">📷 PRENDRE UNE PHOTO <input type="file" accept="image/*" capture="camera" id="f1" style="display:none" onchange="check(this)"></label>
        <label class="btn gal">🖼️ CHOISIR DANS L'ALBUM <input type="file" accept="image/*" id="f2" style="display:none" onchange="check(this)"></label>
        <button id="s" class="btn send" onclick="upload()">🚀 ENVOYER MAINTENANT</button>
        <script>
            let file;
            function check(el) { file = el.files[0]; if(file) document.getElementById('s').style.display='block'; }
            async function upload() {
                const fd = new FormData(); fd.append('photo', file); fd.append('username', document.getElementById('u').value);
                await fetch('/upload', { method: 'POST', body: fd });
                alert('Reçu !'); location.reload();
            }
        </script>
    </body></html>`);
});

// 2. ADMIN (Design calqué sur ta capture d'écran)
app.get('/admin', (req, res) => {
    res.send(`<!DOCTYPE html><html><head><style>
        body { font-family: sans-serif; background: #f0f2f5; margin: 0; }
        .header { background: white; padding: 15px 30px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
        .config-bar { display: flex; gap: 20px; padding: 20px 30px; background: #f0f2f5; }
        .config-card { background: white; padding: 15px 25px; border-radius: 10px; flex: 1; display: flex; align-items: center; gap: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
        .tabs { display: flex; gap: 10px; padding: 0 30px; }
        .tab { flex: 1; padding: 15px; border: none; border-radius: 8px; color: white; font-weight: bold; cursor: pointer; text-transform: uppercase; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 15px; padding: 30px; }
        .item { background: white; padding: 10px; border-radius: 10px; text-align: center; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        .item img { width: 100%; height: 120px; object-fit: cover; border-radius: 6px; }
        .btns { display: flex; gap: 4px; margin-top: 10px; }
        .btns button { flex: 1; border: none; padding: 8px; border-radius: 4px; color: white; cursor: pointer; font-size: 11px; font-weight: bold; }
    </style></head><body>
        <div class="header">
            <h2 style="margin:0">🛡️ Admin Panel</h2>
            <div>
                <button style="padding:10px 20px; border-radius:5px; border:1px solid #ddd; background:white; cursor:pointer;">PHOTOS</button>
                <button style="padding:10px 20px; border-radius:5px; border:1px solid #ddd; background:white; cursor:pointer;">CONFIG</button>
                <button style="padding:10px 20px; border-radius:5px; background:#ff4757; color:white; border:none; cursor:pointer;">QUITTER</button>
            </div>
        </div>
        <div class="config-bar">
            <div class="config-card">AUTO: <input type="checkbox" id="auto" onchange="set()"></div>
            <div class="config-card">TEMPS: <input type="number" id="dur" value="2" style="width:50px" onchange="set()"> s</div>
            <div class="config-card">EFFET: <select id="eff" onchange="set()"><option value="crossfade">Croisé</option><option value="instant">Flash</option></select></div>
        </div>
        <div class="tabs">
            <button class="tab" style="background:#007bff" onclick="view='pending';draw()">Attente</button>
            <button class="tab" style="background:#28a745" onclick="view='approved';draw()">Oui</button>
            <button class="tab" style="background:#ffc107; color:black" onclick="view='rejected';draw()">Non</button>
            <button class="tab" style="background:#333" onclick="view='trashed';draw()">Corbeille</button>
        </div>
        <div id="grid" class="grid"></div>
        <script src="/socket.io/socket.io.js"></script>
        <script>
            const socket = io();
            let view = 'pending', data = { photos: {}, config: {} };
            
            function set() {
                fetch('/config', { method: 'POST', headers: {'Content-Type': 'application/json'}, 
                    body: JSON.stringify({ auto: document.getElementById('auto').checked, duration: document.getElementById('dur').value }) 
                });
            }

            function act(action, item) { fetch('/action', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action, item}) }); }

            socket.on('admin_update', d => { 
                data = d; 
                document.getElementById('auto').checked = d.config.auto;
                document.getElementById('dur').value = d.config.duration;
                draw(); 
            });

            function draw() {
                const g = document.getElementById('grid'); g.innerHTML = '';
                (data.photos[view] || []).forEach(p => {
                    const d = document.createElement('div'); d.className = 'item';
                    d.innerHTML = \`<img src="\${p.url}"><div>\${p.user}</div>
                    <div class="btns">
                        <button style="background:#28a745" onclick='act("approve", \${JSON.stringify(p)})'>OUI</button>
                        <button style="background:#ffc107; color:black" onclick='act("reject", \${JSON.stringify(p)})'>NON</button>
                        <button style="background:#333" onclick='act("trash", \${JSON.stringify(p)})'>🗑️</button>
                    </div>\`;
                    g.appendChild(d);
                });
            }
        </script>
    </body></html>`);
});

// 3. RETRO (Plein écran garanti)
app.get('/retro', (req, res) => {
    res.send(`<!DOCTYPE html><html><body style="background:black; margin:0; overflow:hidden;">
        <div id="m" style="position:fixed; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.9); z-index:100;">
            <button onclick="go()" style="padding:25px 50px; font-size:22px; background:#28a745; color:white; border:none; border-radius:50px; cursor:pointer; font-weight:bold;">LANCER LE PLEIN ÉCRAN</button>
        </div>
        <img id="i" style="width:100vw; height:100vh; object-fit:contain; transition:opacity 1s; opacity:0;">
        <script src="/socket.io/socket.io.js"></script>
        <script>
            const socket = io(); let list = [], cur = 0, timer;
            function go() {
                document.getElementById('m').style.display='none';
                document.documentElement.requestFullscreen();
                run();
            }
            function run() {
                if(list.length > 0) {
                    const img = document.getElementById('i');
                    img.style.opacity = 0;
                    setTimeout(() => {
                        img.src = list[cur].url;
                        img.style.opacity = 1;
                        cur = (cur + 1) % list.length;
                    }, 1000);
                }
                setTimeout(run, 4000);
            }
            socket.on('init_photos', d => { list = d.approved; });
        </script>
    </body></html>`);
});

server.listen(PORT, () => console.log('Connecté sur le port ' + PORT));
