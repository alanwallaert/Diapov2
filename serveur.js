const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const JSZip = require('jszip');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- CONFIGURATION DYNAMIQUE ---
const PORT = 3000;
// Détection automatique de l'IP locale pour le QR Code
let MY_IP = "127.0.0.1";
const nets = os.networkInterfaces();
for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
            MY_IP = net.address;
        }
    }
}

const DB_FILE = path.join(__dirname, 'database.json');
const USERS_FILE = path.join(__dirname, 'users.json');

let approvedPhotos = []; 
let rejectedPhotos = []; 
let trashedPhotos = [];
let autoApprove = false;
let slideDuration = 7000;
let activeClients = {};

// --- CHARGEMENT DB ---
if (fs.existsSync(DB_FILE)) {
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE));
        approvedPhotos = data.approved || [];
        rejectedPhotos = data.rejected || [];
        trashedPhotos = data.trashed || [];
        autoApprove = data.autoApprove || false;
        slideDuration = data.slideDuration || 7000;
    } catch(e) { console.error("Erreur lecture DB"); }
}

function saveDB() {
    const data = { approved: approvedPhotos, rejected: rejectedPhotos, trashed: trashedPhotos, autoApprove, slideDuration };
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

const storage = multer.diskStorage({
    destination: uploadPath,
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
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
    io.emit('init_admin', { approved: approvedPhotos, rejected: rejectedPhotos, trashed: trashedPhotos, autoApprove, slideDuration, stats: stats });
}

io.on('connection', (socket) => {
    const { page, name } = socket.handshake.query;
    if (page && page !== 'admin') activeClients[socket.id] = { name: name || "Anonyme", page: page };
    refreshAll();
    socket.on('disconnect', () => { delete activeClients[socket.id]; refreshAll(); });
});

// --- ROUTES ---

app.get('/login', (req, res) => {
    res.send(`
        <body style="font-family:sans-serif; background:#121212; color:white; display:flex; align-items:center; justify-content:center; height:100vh; margin:0;">
            <form action="/login" method="POST" style="background:#1e1e1e; padding:30px; border-radius:15px; width:280px; text-align:center;">
                <h2 style="color:#28a745; margin-top:0;">Prestation Admin</h2>
                <input type="text" name="userid" placeholder="Identifiant" required style="width:100%; padding:12px; margin-bottom:10px; border-radius:8px; border:none; background:#333; color:white;">
                <input type="password" name="password" placeholder="Mot de passe" required style="width:100%; padding:12px; margin-bottom:20px; border-radius:8px; border:none; background:#333; color:white;">
                <button type="submit" style="width:100%; padding:12px; background:#28a745; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:bold;">SE CONNECTER</button>
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

app.get('/', (req, res) => {
    res.send(`
        <body style="font-family:sans-serif; text-align:center; background:#121212; color:white; padding:20px; margin:0;">
            <div style="background:#1e1e1e; padding:25px; border-radius:20px; max-width:400px; margin:auto;">
                <h2 style="margin-bottom:25px;">📸 Prestation</h2>
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
                    const cam = document.getElementById('file_cam').files[0];
                    const alb = document.getElementById('file_album').files[0];
                    const file = cam || alb;
                    const user = document.getElementById('user').value.trim();
                    
                    if(!file || !user) return alert("Nom + Photo !");
                    
                    btn.disabled = true;
                    btn.innerText = "ENVOI EN COURS...";

                    const fd = new FormData(); 
                    fd.append('photo', file); 
                    fd.append('username', user);

                    try {
                        await fetch('/upload', { method:'POST', body:fd });
                        alert("Envoyé avec succès !"); 
                        location.reload();
                    } catch(e) {
                        alert("Erreur réseau");
                        btn.disabled = false;
                        btn.innerText = "ENVOYER";
                    }
                }
            </script>
        </body>
    `);
});

app.get('/admin', checkAuth, (req, res) => {
    res.send(`
        <body style="font-family:sans-serif; background:#f0f2f5; margin:0; padding:15px;">
            <div style="background:white; padding:15px; border-radius:15px; display:flex; justify-content:space-between; align-items:center; box-shadow:0 2px 10px rgba(0,0,0,0.1); margin-bottom:15px;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=http://${MY_IP}:${PORT}" style="width:40px; border-radius:5px;">
                    <h1 style="margin:0; font-size:18px;">🛡 Admin</h1>
                </div>
                
                <div onclick="document.getElementById('userModal').style.display='flex'" style="background:#e1f5fe; padding:8px 15px; border-radius:20px; cursor:pointer; text-align:center; border:1px solid #01579b;">
                    <span style="color:#01579b; font-weight:bold; font-size:12px;">👥 CONNECTÉS</span><br>
                    <span id="total-online" style="font-size:18px; font-weight:bold; color:#01579b;">0</span>
                </div>

                <div style="display:flex; gap:10px;">
                    <button onclick="showMainTab('photos')" style="padding:8px; border-radius:5px; border:none; background:#444; color:white;">PHOTOS</button>
                    <button onclick="showMainTab('users')" style="padding:8px; border-radius:5px; border:none; background:#444; color:white;">SYSTÈME</button>
                    <a href="/logout" style="text-decoration:none; color:white; background:#dc3545; padding:8px; border-radius:5px;">X</a>
                </div>
            </div>

            <div id="userModal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.8); z-index:1000; align-items:center; justify-content:center; padding:20px;" onclick="this.style.display='none'">
                <div style="background:white; width:100%; max-width:400px; border-radius:15px; padding:20px;" onclick="event.stopPropagation()">
                    <h2 style="margin-top:0; border-bottom:2px solid #eee; padding-bottom:10px;">Utilisateurs en ligne</h2>
                    <div id="user-details" style="max-height:300px; overflow-y:auto; line-height:1.6;"></div>
                    <button onclick="document.getElementById('userModal').style.display='none'" style="width:100%; margin-top:20px; padding:12px; background:#444; color:white; border:none; border-radius:8px; font-weight:bold;">FERMER</button>
                </div>
            </div>

            <div id="main-photos" class="main-tab">
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:15px;">
                    <div style="background:#fff; padding:12px; border-radius:10px; border:2px solid #28a745; display:flex; align-items:center; justify-content:space-between;">
                        <span style="font-weight:bold; color:#28a745; font-size:12px;">🚀 AUTO</span>
                        <input type="checkbox" id="autoCheck" onchange="fetch('/toggle-auto', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({state:this.checked})})">
                    </div>
                    <div style="background:#fff; padding:12px; border-radius:10px; border:2px solid #007bff;">
                        <span style="font-weight:bold; color:#007bff; font-size:11px;">⏱️ VITESSE : <span id="valDuration">7</span>s</span>
                        <input type="range" min="2" max="30" value="7" id="durationRange" style="width:100%;" oninput="document.getElementById('valDuration').innerText=this.value" onchange="fetch('/set-duration', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({duration: this.value * 1000})})">
                    </div>
                </div>

                <button onclick="location.href='/admin/download-zip'" style="width:100%; padding:15px; background:#6f42c1; color:white; border:none; border-radius:10px; font-weight:bold; margin-bottom:15px; cursor:pointer; box-shadow: 0 4px 0 #59359a;">📥 TÉLÉCHARGER TOUTES LES PHOTOS (ZIP)</button>

                <div style="display:flex; gap:5px; margin-bottom:15px;">
                    <button onclick="showTab('pending')" id="btn-pending" style="flex:1; padding:10px; border:none; border-radius:8px; background:#007bff; color:white; font-size:12px;">ATTENTE</button>
                    <button onclick="showTab('approved')" id="btn-approved" style="flex:1; padding:10px; border:none; border-radius:8px; background:#ddd; font-size:12px;">OUI (<span id="nb-oui">0</span>)</button>
                    <button onclick="showTab('rejected')" id="btn-rejected" style="flex:1; padding:10px; border:none; border-radius:8px; background:#ddd; font-size:12px;">NON (<span id="nb-non">0</span>)</button>
                    <button onclick="showTab('trashed')" id="btn-trashed" style="flex:1; padding:10px; border:none; border-radius:8px; background:#ddd; font-size:12px;">🗑️</button>
                </div>
                <div id="tab-pending" class="tab-content"><div id="list-pending" style="display:flex; flex-wrap:wrap; gap:10px;"></div></div>
                <div id="tab-approved" class="tab-content" style="display:none;"><div id="list-approved" style="display:flex; flex-wrap:wrap; gap:10px;"></div></div>
                <div id="tab-rejected" class="tab-content" style="display:none;"><div id="list-rejected" style="display:flex; flex-wrap:wrap; gap:10px;"></div></div>
                <div id="tab-trashed" class="tab-content" style="display:none;"><div id="list-trashed" style="display:flex; flex-wrap:wrap; gap:10px;"></div></div>
            </div>

            <div id="main-users" class="main-tab" style="display:none;">
                <div style="background:white; padding:20px; border-radius:15px; margin-bottom:15px;">
                    <h3 style="color:#dc3545;">⚠️ ZONE DANGER</h3>
                    <button onclick="resetSystem()" style="width:100%; padding:15px; background:#dc3545; color:white; border:none; border-radius:10px; font-weight:bold; cursor:pointer;">RÉINITIALISER TOUTES LES PHOTOS</button>
                </div>
            </div>

            <script src="/socket.io/socket.io.js"></script>
            <script>
                const socket = io();
                function showMainTab(m) { document.querySelectorAll('.main-tab').forEach(el=>el.style.display='none'); document.getElementById('main-'+m).style.display='block'; }
                function showTab(t) { 
                    document.querySelectorAll('.tab-content').forEach(el=>el.style.display='none'); 
                    document.querySelectorAll('button[id^="btn-"]').forEach(b=>{b.style.background='#ddd'; b.style.color='black';}); 
                    document.getElementById('tab-'+t).style.display='block'; 
                    const btn = document.getElementById('btn-'+t);
                    if(t==='pending') btn.style.background='#007bff', btn.style.color='white';
                    if(t==='approved') btn.style.background='#28a745', btn.style.color='white';
                    if(t==='rejected') btn.style.background='#ffc107';
                    if(t==='trashed') btn.style.background='black', btn.style.color='white';
                }

                socket.on('init_admin', d => {
                    const total = d.stats.home.length + d.stats.gallery.length + d.stats.retro.length;
                    document.getElementById('total-online').innerText = total;
                    document.getElementById('user-details').innerText = 
                        '🏠 Accueil ('+d.stats.home.length+'): ' + (d.stats.home.join(', ') || 'Aucun') + '\\n' +
                        '🖼 Galerie ('+d.stats.gallery.length+'): ' + (d.stats.gallery.join(', ') || 'Aucun') + '\\n' +
                        '📽 Diaporama ('+d.stats.retro.length+'): ' + (d.stats.retro.join(', ') || 'Aucun');

                    document.getElementById('nb-oui').innerText = d.approved.length;
                    document.getElementById('nb-non').innerText = d.rejected.length;
                    document.getElementById('autoCheck').checked = d.autoApprove;
                    document.getElementById('durationRange').value = d.slideDuration / 1000;
                    document.getElementById('valDuration').innerText = d.slideDuration / 1000;
                    
                    ['approved','rejected','trashed'].forEach(type => {
                        const l = document.getElementById('list-'+type); l.innerHTML = "";
                        d[type].forEach(p => {
                            const div = document.createElement('div');
                            div.style = "background:white; padding:5px; border-radius:8px; width:90px; text-align:center; box-shadow:0 1px 3px rgba(0,0,0,0.1);";
                            let buttons = "";
                            if(type!=='approved') buttons += '<button onclick="act(\\'/approve\\',\\''+p.url+'\\',\\''+p.user+'\\')" style="background:#28a745;color:white;font-size:8px;border:none;width:100%;margin-bottom:2px;">OUI</button>';
                            if(type!=='rejected') buttons += '<button onclick="act(\\'/reject\\',\\''+p.url+'\\',\\''+p.user+'\\')" style="background:#ffc107;font-size:8px;border:none;width:100%;margin-bottom:2px;">NON</button>';
                            if(type!=='trashed') buttons += '<button onclick="act(\\'/delete\\',\\''+p.url+'\\',\\''+p.user+'\\')" style="background:black;color:white;font-size:8px;border:none;width:100%;">🗑️</button>';
                            
                            const img = document.createElement('img');
                            img.src = p.url;
                            img.style = "width:100%; height:60px; object-fit:cover; border-radius:5px;";
                            div.appendChild(img);
                            const btnBox = document.createElement('div');
                            btnBox.style.marginTop = "5px";
                            btnBox.innerHTML = buttons;
                            div.appendChild(btnBox);
                            l.appendChild(div);
                        });
                    });
                });

                socket.on('new_photo_pending', p => {
                    const l = document.getElementById('list-pending');
                    const div = document.createElement('div'); div.style = "background:white; padding:10px; border-radius:10px; width:130px; border:2px solid #007bff;";
                    const nameTag = document.createElement('p');
                    nameTag.style.fontSize = "11px";
                    nameTag.textContent = p.user; // Sécurité XSS
                    div.innerHTML = '<img src="'+p.url+'" style="width:100%; border-radius:5px;">';
                    div.appendChild(nameTag);
                    div.innerHTML += '<button onclick="this.parentElement.remove(); act(\\'/approve\\',\\''+p.url+'\\',\\''+p.user+'\\')" style="background:#28a745;color:white;width:48%;border:none;padding:5px;">OUI</button> ' +
                    '<button onclick="this.parentElement.remove(); act(\\'/reject\\',\\''+p.url+'\\',\\''+p.user+'\\')" style="background:#dc3545;color:white;width:48%;border:none;padding:5px;">NON</button>';
                    l.prepend(div);
                });

                function act(r,u,usr) { fetch(r,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:u,user:usr})}); }
                function resetSystem() { if(confirm("Voulez-vous vraiment TOUT effacer ?")) fetch('/admin/reset',{method:'POST'}).then(()=>location.reload()); }
            </script>
        </body>
    `);
});

// --- ROUTE ZIP OPTIMISÉE ---
app.get('/admin/download-zip', checkAuth, async (req, res) => {
    try {
        const zip = new JSZip();
        for (const p of approvedPhotos) {
            const filePath = path.join(publicPath, p.url);
            if (fs.existsSync(filePath)) {
                const data = await fs.promises.readFile(filePath);
                zip.file(path.basename(p.url), data);
            }
        }
        const content = await zip.generateAsync({ type: "nodebuffer" });
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename=photos_mariage.zip');
        res.send(content);
    } catch (e) { res.status(500).send("Erreur ZIP"); }
});

app.get('/retro', (req, res) => {
    res.send(`
        <body style="background:black; color:white; margin:0; overflow:hidden; font-family:sans-serif; text-align:center; cursor: pointer;" onclick="toggleFS()">
            <div id="start-btn" style="position:fixed; inset:0; background:rgba(0,0,0,0.95); z-index:100; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                <button onclick="start(event)" style="padding:20px 40px; font-size:22px; border-radius:40px; background:#28a745; color:white; border:none; cursor:pointer; font-weight:bold;">📽️ LANCER LE DIAPORAMA</button>
            </div>
            <div id="main" style="height:100vh; display:flex; align-items:center; justify-content:center; position:relative;">
                <h1 id="msg">En attente...</h1>
                <img id="img" style="max-width:100%; max-height:100vh; display:none; transition: opacity 1s; object-fit: contain;">
                <div id="tag" style="position:absolute; bottom:50px; background:rgba(0,0,0,0.7); padding:10px 30px; border-radius:30px; font-size:30px; display:none;"></div>
            </div>
            <script src="/socket.io/socket.io.js"></script>
            <script>
                const socket = io({ query: { page: 'retro', name: 'Écran Diapo' } });
                let list = []; let cur = 0; let t = null; let currentDuration = 7000;
                function toggleFS() { if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(e => {}); }
                socket.on('init_photos', (data) => { 
                    list = data.photos; currentDuration = data.duration;
                    if (t) { clearInterval(t); t = setInterval(loop, currentDuration); }
                });
                function start(e) { e.stopPropagation(); toggleFS(); document.getElementById('start-btn').style.display='none'; if(list.length) loop(); }
                function loop() {
                    const i = document.getElementById('img'); const tag = document.getElementById('tag');
                    if(!list.length) return;
                    document.getElementById('msg').style.display='none'; i.style.display='block'; tag.style.display='block'; i.style.opacity = 0;
                    setTimeout(() => { 
                        i.src = list[cur].url; 
                        tag.textContent = "📸 " + list[cur].user; // Sécurité XSS
                        i.style.opacity = 1; 
                        cur = (cur + 1) % list.length; 
                    }, 100);
                    if(!t) t = setInterval(loop, currentDuration);
                }
            </script>
        </body>
    `);
});

app.post('/upload', upload.single('photo'), (req, res) => {
    const data = { url: '/uploads/'+req.file.filename, user: req.body.username || "Anonyme" };
    if (autoApprove) { approvedPhotos.push(data); refreshAll(); }
    else io.emit('new_photo_pending', data);
    res.sendStatus(200);
});

app.post('/approve', checkAuth, (req, res) => {
    const p = req.body;
    trashedPhotos = trashedPhotos.filter(x => x.url !== p.url);
    rejectedPhotos = rejectedPhotos.filter(x => x.url !== p.url);
    if(!approvedPhotos.find(x => x.url === p.url)) approvedPhotos.push(p);
    refreshAll(); res.sendStatus(200);
});

app.post('/reject', checkAuth, (req, res) => {
    const p = req.body;
    approvedPhotos = approvedPhotos.filter(x => x.url !== p.url);
    if(!rejectedPhotos.find(x => x.url === p.url)) rejectedPhotos.push(p);
    refreshAll(); res.sendStatus(200);
});

app.post('/delete', checkAuth, (req, res) => {
    const p = req.body;
    approvedPhotos = approvedPhotos.filter(x => x.url !== p.url);
    rejectedPhotos = rejectedPhotos.filter(x => x.url !== p.url);
    if(!trashedPhotos.find(x => x.url === p.url)) trashedPhotos.push(p);
    refreshAll(); res.sendStatus(200);
});

app.post('/admin/reset', checkAuth, (req, res) => {
    approvedPhotos = []; rejectedPhotos = []; trashedPhotos = [];
    refreshAll(); res.sendStatus(200);
});

app.post('/toggle-auto', checkAuth, (req, res) => { autoApprove = req.body.state; refreshAll(); res.sendStatus(200); });
app.post('/set-duration', checkAuth, (req, res) => { slideDuration = parseInt(req.body.duration); refreshAll(); res.sendStatus(200); });

app.get('/gallery', (req, res) => {
    res.send(`
        <body style="background:#121212;color:white;font-family:sans-serif;padding:20px;text-align:center;">
            <h2>🖼️ Galerie</h2>
            <div id="grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;"></div>
            <button onclick="location.href='/'" style="margin-top:20px;padding:10px;background:#007bff;color:white;border:none;border-radius:8px;">RETOUR</button>
            <script src="/socket.io/socket.io.js"></script>
            <script>
                const socket=io({ query: { page: 'gallery', name: localStorage.getItem('p_name') || 'Anonyme' } });
                socket.on('init_photos',data=>{
                    const g=document.getElementById('grid'); g.innerHTML="";
                    data.photos.forEach(p=>{
                        const img = document.createElement('img');
                        img.src = p.url;
                        img.style = "width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:10px;";
                        g.appendChild(img);
                    });
                });
            </script>
        </body>`);
});

server.listen(PORT, '0.0.0.0', () => {
    console.log("------------------------------------------");
    console.log("🚀 Serveur lancé avec succès !");
    console.log("🔗 Accès Admin : http://" + MY_IP + ":" + PORT + "/login");
    console.log("------------------------------------------");
    refreshAll();
});