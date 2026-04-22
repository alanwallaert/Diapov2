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
const DB_FILE = './database.json';
const USERS_FILE = './users.json';

let approvedPhotos = []; 
let rejectedPhotos = []; 
let trashedPhotos = [];
let autoApprove = false;
let slideDuration = 7000;
let activeClients = {};

// Dossiers
const publicPath = path.join(__dirname, 'public');
const uploadPath = path.join(publicPath, 'uploads');

[publicPath, uploadPath].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Initialisation Utilisateur
if (!fs.existsSync(USERS_FILE)) {
    const hashed = bcrypt.hashSync("1234", 10);
    fs.writeFileSync(USERS_FILE, JSON.stringify([{ id: "admin", pass: hashed }]));
}

// Chargement DB
if (fs.existsSync(DB_FILE)) {
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE));
        approvedPhotos = data.approved || [];
        rejectedPhotos = data.rejected || [];
        trashedPhotos = data.trashed || [];
        autoApprove = !!data.autoApprove;
        slideDuration = data.slideDuration || 7000;
    } catch(e) { console.error("Erreur lecture DB, on repart à zéro."); }
}

function saveDB() {
    const data = { approved: approvedPhotos, rejected: rejectedPhotos, trashed: trashedPhotos, autoApprove, slideDuration };
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

app.use(session({ secret: 'prestation-top-secret', resave: false, saveUninitialized: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(publicPath));

const storage = multer.diskStorage({
    destination: uploadPath,
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({ storage });

const checkAuth = (req, res, next) => {
    if (req.session.user) next();
    else res.redirect('/login');
};

function refreshAll() {
    saveDB();
    let stats = { home: [], gallery: [], retro: [] };
    Object.values(activeClients).forEach(c => {
        if (stats[c.page]) stats[c.page].push(c.name);
    });
    io.emit('init_photos', { photos: approvedPhotos, duration: slideDuration });
    io.emit('init_admin', { approved: approvedPhotos, rejected: rejectedPhotos, trashed: trashedPhotos, autoApprove, slideDuration, stats });
}

// --- SOCKETS ---
io.on('connection', (socket) => {
    const { page, name } = socket.handshake.query;
    if (page && page !== 'admin') activeClients[socket.id] = { name: name || "Anonyme", page: page };
    
    // On envoie les infos uniquement au client qui se connecte pour ne pas spammer les autres
    socket.emit('init_photos', { photos: approvedPhotos, duration: slideDuration });
    refreshAll(); 

    socket.on('disconnect', () => { 
        delete activeClients[socket.id]; 
        refreshAll(); 
    });
});

// --- ROUTES ---

app.get('/login', (req, res) => {
    res.send(`<body style="font-family:sans-serif; background:#121212; color:white; display:flex; align-items:center; justify-content:center; height:100vh; margin:0;"><form action="/login" method="POST" style="background:#1e1e1e; padding:30px; border-radius:15px; width:280px; text-align:center;"><h2 style="color:#28a745; margin-top:0;">Prestation Admin</h2><input type="text" name="userid" placeholder="Identifiant" required style="width:100%; padding:12px; margin-bottom:10px; border-radius:8px; border:none; background:#333; color:white;"><input type="password" name="password" placeholder="Mot de passe" required style="width:100%; padding:12px; margin-bottom:20px; border-radius:8px; border:none; background:#333; color:white;"><button type="submit" style="width:100%; padding:12px; background:#28a745; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:bold;">SE CONNECTER</button></form></body>`);
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

// --- INTERFACE CLIENT ---
app.get('/', (req, res) => {
    res.send(`
        <body style="font-family:sans-serif; text-align:center; background:#121212; color:white; padding:20px; margin:0;">
            <div style="background:#1e1e1e; padding:25px; border-radius:20px; max-width:400px; margin:auto;">
                <h2 style="margin-bottom:25px;">📸 Prestation</h2>
                <input type="text" id="user" oninput="localStorage.setItem('p_name', this.value)" placeholder="Votre Prénom" style="width:100%; padding:15px; margin-bottom:20px; border-radius:10px; border:none; background:#333; color:white; font-size:16px;">
                <div style="display:flex; flex-direction:column; gap:15px;">
                    <label style="background:#007bff; padding:20px; border-radius:15px; cursor:pointer; font-weight:bold;"><input type="file" id="file_cam" accept="image/*" capture="camera" style="display:none;" onchange="handleFile(this, '📸 PHOTO PRÊTE')"><span>📷 PRENDRE UNE PHOTO</span></label>
                    <label style="background:#444; padding:20px; border-radius:15px; cursor:pointer; font-weight:bold;"><input type="file" id="file_album" accept="image/*" style="display:none;" onchange="handleFile(this, '🖼️ IMAGE CHOISIE')"><span>📁 CHOISIR UN FICHIER</span></label>
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
                    const btn = document.getElementById('sendBtn');
                    const file = document.getElementById('file_cam').files[0] || document.getElementById('file_album').files[0];
                    const user = document.getElementById('user').value;
                    if(!file || !user) return alert("Nom + Photo requis !");
                    btn.disabled = true; btn.innerText = "ENVOI EN COURS...";
                    const fd = new FormData(); fd.append('photo', file); fd.append('username', user);
                    await fetch('/upload', { method:'POST', body:fd });
                    alert("Envoyé !"); location.reload();
                }
            </script>
        </body>
    `);
});

// --- ADMIN ---
app.get('/admin', checkAuth, (req, res) => {
    res.send(`
        <body style="font-family:sans-serif; background:#f0f2f5; margin:0; padding:15px;">
            <div style="background:white; padding:15px; border-radius:15px; display:flex; justify-content:space-between; align-items:center; box-shadow:0 2px 10px rgba(0,0,0,0.1); margin-bottom:15px;">
                <h1 style="margin:0; font-size:18px;">🛡 Admin</h1>
                <div onclick="document.getElementById('userModal').style.display='flex'" style="background:#e1f5fe; padding:8px 15px; border-radius:20px; cursor:pointer; text-align:center; border:1px solid #01579b;">
                    <span id="total-online" style="font-size:18px; font-weight:bold; color:#01579b;">0</span> <span style="font-size:10px;">👤</span>
                </div>
                <div style="display:flex; gap:10px;">
                    <button onclick="showMainTab('photos')" style="padding:8px; border-radius:5px; border:none; background:#444; color:white;">PHOTOS</button>
                    <button onclick="showMainTab('users')" style="padding:8px; border-radius:5px; border:none; background:#444; color:white;">⚙️</button>
                    <a href="/logout" style="text-decoration:none; color:white; background:#dc3545; padding:8px; border-radius:5px;">X</a>
                </div>
            </div>

            <div id="userModal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.8); z-index:1000; align-items:center; justify-content:center; padding:20px;" onclick="this.style.display='none'">
                <div style="background:white; width:100%; max-width:400px; border-radius:15px; padding:20px;" onclick="event.stopPropagation()">
                    <h2 style="margin-top:0;">Connectés</h2>
                    <div id="user-details" style="max-height:300px; overflow-y:auto;"></div>
                </div>
            </div>

            <div id="main-photos" class="main-tab">
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:15px;">
                    <div style="background:#fff; padding:12px; border-radius:10px; border:2px solid #28a745;">
                        <label><input type="checkbox" id="autoCheck" onchange="act('/toggle-auto', {state:this.checked})"> 🚀 AUTO</label>
                    </div>
                    <div style="background:#fff; padding:12px; border-radius:10px; border:2px solid #007bff;">
                        <span style="font-size:11px;">⏱️ <span id="valDuration">7</span>s</span>
                        <input type="range" min="2" max="30" value="7" id="durationRange" style="width:100%;" onchange="act('/set-duration', {duration: this.value * 1000})">
                    </div>
                </div>
                <button onclick="location.href='/admin/download-zip'" style="width:100%; padding:15px; background:#6f42c1; color:white; border:none; border-radius:10px; font-weight:bold; margin-bottom:15px;">📥 TÉLÉCHARGER LE ZIP</button>
                <div style="display:flex; gap:5px; margin-bottom:15px;">
                    <button onclick="showTab('pending')" id="btn-pending" style="flex:1; padding:10px; border:none; border-radius:8px;">ATTENTE</button>
                    <button onclick="showTab('approved')" id="btn-approved" style="flex:1; padding:10px; border:none; border-radius:8px;">OUI (<span id="nb-oui">0</span>)</button>
                    <button onclick="showTab('rejected')" id="btn-rejected" style="flex:1; padding:10px; border:none; border-radius:8px;">NON (<span id="nb-non">0</span>)</button>
                </div>
                <div id="tab-pending" class="tab-content"><div id="list-pending" style="display:flex; flex-wrap:wrap; gap:10px;"></div></div>
                <div id="tab-approved" class="tab-content" style="display:none;"><div id="list-approved" style="display:flex; flex-wrap:wrap; gap:10px;"></div></div>
                <div id="tab-rejected" class="tab-content" style="display:none;"><div id="list-rejected" style="display:flex; flex-wrap:wrap; gap:10px;"></div></div>
            </div>

            <div id="main-users" class="main-tab" style="display:none;">
                <div style="background:white; padding:20px; border-radius:15px;">
                    <h3 style="color:#dc3545;">⚠️ ZONE DANGER</h3>
                    <button onclick="resetSystem()" style="width:100%; padding:15px; background:#dc3545; color:white; border:none; border-radius:10px; font-weight:bold;">TOUT RÉINITIALISER</button>
                </div>
            </div>

            <script src="/socket.io/socket.io.js"></script>
            <script>
                const socket = io();
                function showMainTab(m) { document.querySelectorAll('.main-tab').forEach(el=>el.style.display='none'); document.getElementById('main-'+m).style.display='block'; }
                function showTab(t) { 
                    document.querySelectorAll('.tab-content').forEach(el=>el.style.display='none'); 
                    document.getElementById('tab-'+t).style.display='block'; 
                }
                function act(route, data) { fetch(route, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)}); }

                socket.on('init_admin', d => {
                    document.getElementById('total-online').innerText = d.stats.home.length + d.stats.gallery.length + d.stats.retro.length;
                    document.getElementById('nb-oui').innerText = d.approved.length;
                    document.getElementById('nb-non').innerText = d.rejected.length;
                    document.getElementById('autoCheck').checked = d.autoApprove;
                    
                    ['approved','rejected'].forEach(type => {
                        const l = document.getElementById('list-'+type); l.innerHTML = "";
                        d[type].forEach(p => {
                            const div = document.createElement('div');
                            div.style = "background:white; padding:5px; border-radius:8px; width:90px; text-align:center; box-shadow:0 1px 3px rgba(0,0,0,0.1);";
                            div.innerHTML = '<img src="'+p.url+'" style="width:100%; height:60px; object-fit:cover; border-radius:5px;">' +
                            '<button onclick="act(\\'' + (type==='approved' ? '/reject' : '/approve') + '\\', {url:\\''+p.url+'\\', user:\\''+p.user+'\\'})" style="width:100%; margin-top:20px; font-size:10px;">CHANGER</button>';
                            l.appendChild(div);
                        });
                    });
                });

                socket.on('new_photo_pending', p => {
                    const l = document.getElementById('list-pending');
                    const div = document.createElement('div'); div.style = "background:white; padding:10px; border-radius:10px; width:130px; border:2px solid #007bff;";
                    div.innerHTML = '<img src="'+p.url+'" style="width:100%; border-radius:5px;"><p style="font-size:11px;">'+p.user+'</p>' +
                    '<button onclick="this.parentElement.remove(); act(\\'/approve\\', {url:\\''+p.url+'\\', user:\\''+p.user+'\\'})" style="background:#28a745;color:white;width:48%;border:none;padding:5px;">OUI</button> ' +
                    '<button onclick="this.parentElement.remove(); act(\\'/reject\\', {url:\\''+p.url+'\\', user:\\''+p.user+'\\'})" style="background:#dc3545;color:white;width:48%;border:none;padding:5px;">NON</button>';
                    l.prepend(div);
                });

                function resetSystem() { if(confirm("Voulez-vous vraiment TOUT effacer (fichiers inclus) ?")) act('/admin/reset', {}); setTimeout(()=>location.reload(), 500); }
                showTab('pending');
            </script>
        </body>
    `);
});

// --- ZIP DOWNLOAD (CORRIGÉ) ---
app.get('/admin/download-zip', checkAuth, async (req, res) => {
    const zip = new JSZip();
    approvedPhotos.forEach(p => {
        const cleanPath = p.url.replace(/^\//, ''); // Retire le slash initial si présent
        const filePath = path.join(publicPath, cleanPath);
        if (fs.existsSync(filePath)) {
            zip.file(path.basename(p.url), fs.readFileSync(filePath));
        }
    });
    const content = await zip.generateAsync({ type: "nodebuffer" });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=photos_event.zip');
    res.send(content);
});

// --- DIAPORAMA ---
app.get('/retro', (req, res) => {
    res.send(`
        <body style="background:black; color:white; margin:0; overflow:hidden; font-family:sans-serif; text-align:center;">
            <div id="start-btn" style="position:fixed; inset:0; background:rgba(0,0,0,0.9); z-index:100; display:flex; align-items:center; justify-content:center;">
                <button onclick="start()" style="padding:20px 40px; font-size:22px; border-radius:40px; background:#28a745; color:white; border:none; cursor:pointer;">📽️ LANCER LE DIAPORAMA</button>
            </div>
            <div id="main" style="height:100vh; display:flex; align-items:center; justify-content:center; position:relative;">
                <h1 id="msg">En attente de photos...</h1>
                <img id="img" style="max-width:100%; max-height:100vh; display:none; transition: opacity 1s; object-fit: contain;">
                <div id="tag" style="position:absolute; bottom:50px; background:rgba(0,0,0,0.7); padding:10px 30px; border-radius:30px; font-size:30px; display:none;"></div>
            </div>
            <script src="/socket.io/socket.io.js"></script>
            <script>
                const socket = io({ query: { page: 'retro', name: 'Ecran' } });
                let list = []; let cur = 0; let timer = null; let duration = 7000;
                
                socket.on('init_photos', d => { 
                    list = d.photos; duration = d.duration;
                    if(list.length > 0 && !timer) { document.getElementById('msg').style.display='none'; }
                });

                function start() {
                    document.getElementById('start-btn').style.display='none';
                    if(document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
                    loop();
                }

                function loop() {
                    if(list.length > 0) {
                        const i = document.getElementById('img');
                        const t = document.getElementById('tag');
                        i.style.display = 'block'; t.style.display = 'block';
                        i.style.opacity = 0;
                        setTimeout(() => {
                            i.src = list[cur].url;
                            t.innerText = "📸 " + list[cur].user;
                            i.style.opacity = 1;
                            cur = (cur + 1) % list.length;
                        }, 500);
                    }
                    setTimeout(loop, duration);
                }
            </script>
        </body>
    `);
});

// --- ACTIONS API ---
app.post('/upload', upload.single('photo'), (req, res) => {
    if (!req.file) return res.sendStatus(400);
    const data = { url: '/uploads/'+req.file.filename, user: req.body.username || "Anonyme" };
    if (autoApprove) { approvedPhotos.push(data); refreshAll(); }
    else io.emit('new_photo_pending', data);
    res.sendStatus(200);
});

app.post('/approve', checkAuth, (req, res) => {
    const { url, user } = req.body;
    rejectedPhotos = rejectedPhotos.filter(x => x.url !== url);
    if (!approvedPhotos.find(x => x.url === url)) approvedPhotos.push({url, user});
    refreshAll(); res.sendStatus(200);
});

app.post('/reject', checkAuth, (req, res) => {
    const { url, user } = req.body;
    approvedPhotos = approvedPhotos.filter(x => x.url !== url);
    if (!rejectedPhotos.find(x => x.url === url)) rejectedPhotos.push({url, user});
    refreshAll(); res.sendStatus(200);
});

app.post('/admin/reset', checkAuth, (req, res) => {
    // Supprimer les fichiers physiques
    const files = fs.readdirSync(uploadPath);
    for (const file of files) {
        try { fs.unlinkSync(path.join(uploadPath, file)); } catch(e) {}
    }
    approvedPhotos = []; rejectedPhotos = []; trashedPhotos = [];
    refreshAll(); res.sendStatus(200);
});

app.post('/toggle-auto', checkAuth, (req, res) => { autoApprove = req.body.state; refreshAll(); res.sendStatus(200); });
app.post('/set-duration', checkAuth, (req, res) => { slideDuration = parseInt(req.body.duration); refreshAll(); res.sendStatus(200); });

app.get('/gallery', (req, res) => {
    res.send(`<body style="background:#121212;color:white;font-family:sans-serif;padding:20px;text-align:center;"><h2>🖼️ Galerie</h2><div id="grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;"></div><button onclick="location.href='/'" style="margin-top:20px;padding:10px;background:#007bff;color:white;border:none;border-radius:8px;">RETOUR</button><script src="/socket.io/socket.io.js"></script><script>const socket=io({query:{page:'gallery',name:localStorage.getItem('p_name')||'Anonyme'}});socket.on('init_photos',d=>{const g=document.getElementById('grid');g.innerHTML="";d.photos.forEach(p=>{g.innerHTML+='<img src="'+p.url+'" style="width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:10px;">';});});</script></body>`);
});

// --- KEEP ALIVE ---
const URL_DU_SITE = 'https://diapov2.onrender.com/';
setInterval(() => {
    http.get(URL_DU_SITE, (res) => console.log("Ping Keep-alive OK"));
}, 800000); 

server.listen(PORT, () => {
    console.log("🚀 Serveur prêt sur le port " + PORT);
    refreshAll();
});
