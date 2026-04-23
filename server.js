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
let transitionType = "crossfade"; 
let eventCode = "1234"; 
let isEventActive = true; 
let activeClients = {};

// --- PERSISTENCE ---
if (fs.existsSync(DB_FILE)) {
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE));
        approvedPhotos = data.approved || [];
        rejectedPhotos = data.rejected || [];
        trashedPhotos = data.trashed || [];
        autoApprove = !!data.autoApprove;
        slideDuration = data.slideDuration || 7000;
        transitionType = data.transitionType || "crossfade";
        eventCode = data.eventCode || "1234";
        isEventActive = data.isEventActive !== undefined ? data.isEventActive : true;
    } catch(e) { console.log("Erreur lecture DB"); }
}

function saveDB() {
    const data = { approved: approvedPhotos, rejected: rejectedPhotos, trashed: trashedPhotos, autoApprove, slideDuration, transitionType, eventCode, isEventActive };
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

const publicPath = path.join(__dirname, 'public');
const uploadPath = path.join(publicPath, 'uploads');
[publicPath, uploadPath].forEach(dir => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); });

if (!fs.existsSync(USERS_FILE)) {
    const hashed = bcrypt.hashSync("1234", 10);
    fs.writeFileSync(USERS_FILE, JSON.stringify([{ id: "admin", pass: hashed }]));
}

// --- MIDDLEWARES ---
app.use(session({ secret: 'prestation-top-secret', resave: false, saveUninitialized: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(publicPath));

const storage = multer.diskStorage({
    destination: uploadPath,
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

const checkAuth = (req, res, next) => { if (req.session.user) next(); else res.redirect('/login'); };
const checkEventAccess = (req, res, next) => {
    if (!isEventActive) return res.send(`<body style="background:#121212;color:white;text-align:center;padding:50px;font-family:sans-serif;"><h1>🔒 Prestation terminée</h1><p>L'accès est fermé.</p></body>`);
    if (req.session.hasAccess) return next();
    res.send(`<body style="background:#121212;color:white;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;"><div style="background:#1e1e1e;padding:40px;border-radius:20px;text-align:center;width:300px;"><h2 style="color:#28a745;">Accès Événement</h2><input type="text" id="c" placeholder="CODE" style="width:100%;padding:15px;margin-bottom:20px;border-radius:10px;border:none;background:#333;color:white;text-align:center;font-size:24px;"><button onclick="check()" style="width:100%;padding:15px;background:#28a745;color:white;border:none;border-radius:10px;cursor:pointer;">ENTRER</button></div><script>async function check(){const c=document.getElementById('c').value;const r=await fetch('/verify-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:c})});if(r.ok)location.reload();else alert("Code faux")}</script></body>`);
};

// --- LOGIQUE TEMPS RÉEL ---
function refreshAll() {
    saveDB();
    let stats = { home: [], gallery: [], retro: [] };
    Object.values(activeClients).forEach(c => { if (stats[c.page]) stats[c.page].push(c.name); });
    io.emit('init_photos', { photos: approvedPhotos, duration: slideDuration, transitionType });
    io.emit('init_admin', { approved: approvedPhotos, rejected: rejectedPhotos, trashed: trashedPhotos, autoApprove, slideDuration, transitionType, eventCode, isEventActive, stats });
}

io.on('connection', (socket) => {
    const { page, name } = socket.handshake.query;
    if (page && page !== 'admin') activeClients[socket.id] = { name: name || "Anonyme", page };
    refreshAll();
    socket.on('disconnect', () => { delete activeClients[socket.id]; refreshAll(); });
});

// --- ROUTES AUTH ---
app.post('/verify-code', (req, res) => { if (req.body.code === eventCode) { req.session.hasAccess = true; res.sendStatus(200); } else res.sendStatus(403); });
app.get('/login', (req, res) => { res.send(`<body style="background:#121212;color:white;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;"><form action="/login" method="POST" style="background:#1e1e1e;padding:30px;border-radius:15px;text-align:center;"><h2 style="color:#28a745;">Admin</h2><input type="text" name="userid" placeholder="ID" required style="display:block;margin:10px auto;padding:10px;"><input type="password" name="password" placeholder="PASS" required style="display:block;margin:10px auto;padding:10px;"><button type="submit" style="padding:10px 20px;background:#28a745;color:white;border:none;border-radius:5px;cursor:pointer;">CONNEXION</button></form></body>`); });
app.post('/login', (req, res) => {
    const users = JSON.parse(fs.readFileSync(USERS_FILE));
    const user = users.find(u => u.id === req.body.userid);
    if (user && bcrypt.compareSync(req.body.password, user.pass)) { req.session.user = user.id; res.redirect('/admin'); } else res.send("<script>alert('Erreur'); window.location='/login';</script>");
});
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// --- ROUTES PHOTOS ---
app.get('/', checkEventAccess, (req, res) => {
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Partage Photo</title></head><body style="font-family:sans-serif;background:#121212;color:white;text-align:center;padding:20px;margin:0;"><div style="background:#1e1e1e;padding:25px;border-radius:20px;max-width:400px;margin:auto;"><h2>📸 Partager une Photo</h2><input type="text" id="user" oninput="localStorage.setItem('p_name', this.value)" placeholder="Prénom" style="width:100%;padding:15px;margin-bottom:20px;border-radius:10px;border:none;background:#333;color:white;"><div style="display:flex;flex-direction:column;gap:15px;"><label style="background:#007bff;padding:20px;border-radius:15px;cursor:pointer;">📷 PRENDRE PHOTO<input type="file" id="file_cam" accept="image/*" capture="camera" style="display:none;" onchange="this.previousSibling.textContent='✅ PRÊT'"></label></div><button id="s" onclick="send()" style="width:100%;padding:20px;background:#28a745;color:white;border:none;border-radius:12px;margin-top:30px;font-weight:bold;">ENVOYER</button><button onclick="location.href='/gallery'" style="width:100%;padding:15px;background:transparent;color:#007bff;border:2px solid #007bff;border-radius:12px;margin-top:15px;font-weight:bold;">🖼️ GALERIE</button></div><script>async function send(){const f=document.getElementById('file_cam').files[0],u=document.getElementById('user').value;if(!f||!u)return alert("Nom + Photo !");const b=document.getElementById('s');b.disabled=true;b.innerText='ENVOI...';const fd=new FormData();fd.append('photo',f);fd.append('username',u);await fetch('/upload',{method:'POST',body:fd});alert("Merci !");location.reload();}</script></body></html>`);
});

app.post('/upload', upload.single('photo'), (req, res) => {
    const data = { url: '/uploads/'+req.file.filename, user: req.body.username };
    if (autoApprove) { approvedPhotos.push(data); refreshAll(); }
    else io.emit('new_photo_pending', data);
    res.sendStatus(200);
});

app.get('/gallery', checkEventAccess, (req, res) => {
    res.send(`<body style="background:#121212;color:white;font-family:sans-serif;padding:20px;text-align:center;"><h2>🖼️ Galerie</h2><div id="grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;"></div><br><button onclick="location.href='/'" style="padding:10px;background:#444;color:white;border:none;border-radius:8px;">RETOUR</button><script src="/socket.io/socket.io.js"></script><script>const s=io({query:{page:'gallery',name:localStorage.getItem('p_name')||'Anonyme'}});s.on('init_photos',d=>{const g=document.getElementById('grid');g.innerHTML="";d.photos.forEach(p=>{g.innerHTML+='<img src="'+p.url+'" style="width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:10px;">'});});</script></body>`);
});

// --- ADMIN ---
app.get('/admin', checkAuth, (req, res) => {
    res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f0f2f5;padding:15px;margin:0;">
        <div style="background:white;padding:15px;border-radius:15px;display:flex;justify-content:space-between;align-items:center;box-shadow:0 2px 5px rgba(0,0,0,0.1);">
            <h2 style="margin:0;">🛡️ Admin Panel</h2>
            <div style="display:flex;gap:10px;">
                <button onclick="showMainTab('photos')">PHOTOS</button>
                <button onclick="showMainTab('sys')">SYSTÈME</button>
                <a href="/logout" style="background:red;color:white;padding:5px 10px;border-radius:5px;text-decoration:none;">X</a>
            </div>
        </div>

        <div id="main-photos">
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:15px;">
                <div style="background:white;padding:10px;border-radius:10px;">AUTO: <input type="checkbox" id="autoCheck" onchange="act('/toggle-auto',{state:this.checked})"></div>
                <div style="background:white;padding:10px;border-radius:10px;">VITESSE: <input type="number" id="vitesse" style="width:40px" onchange="act('/set-duration',{duration:this.value*1000})">s</div>
                <div style="background:white;padding:10px;border-radius:10px;">EFFET: <select id="effet" onchange="act('/set-transition',{type:this.value})"><option value="crossfade">Croisé</option><option value="fade-to-black">Noir</option><option value="instant">Flash</option></select></div>
            </div>
            
            <button onclick="location.href='/admin/download-zip'" style="width:100%;padding:15px;background:#6f42c1;color:white;border:none;border-radius:10px;margin:15px 0;font-weight:bold;">📥 TÉLÉCHARGER TOUT (ZIP)</button>

            <div style="display:flex;gap:5px;margin-bottom:15px;">
                <button onclick="showTab('pending')" id="btn-pending" style="flex:1;padding:10px;">ATTENTE</button>
                <button onclick="showTab('approved')" id="btn-approved" style="flex:1;padding:10px;">OUI (<span id="nb-oui">0</span>)</button>
                <button onclick="showTab('rejected')" id="btn-rejected" style="flex:1;padding:10px;">NON (<span id="nb-non">0</span>)</button>
                <button onclick="showTab('trashed')" id="btn-trashed" style="flex:1;padding:10px;">🗑️</button>
            </div>

            <div id="tab-pending" class="tab-content"><div id="list-pending" style="display:flex;flex-wrap:wrap;gap:10px;"></div></div>
            <div id="tab-approved" class="tab-content" style="display:none;"><div id="list-approved" style="display:flex;flex-wrap:wrap;gap:10px;"></div></div>
            <div id="tab-rejected" class="tab-content" style="display:none;"><div id="list-rejected" style="display:flex;flex-wrap:wrap;gap:10px;"></div></div>
            <div id="tab-trashed" class="tab-content" style="display:none;"><div id="list-trashed" style="display:flex;flex-wrap:wrap;gap:10px;"></div></div>
        </div>

        <div id="main-sys" style="display:none;margin-top:15px;">
            <div style="background:white;padding:20px;border-radius:15px;">
                CODE ACCÈS: <input type="text" id="codeI" style="width:100px"><button onclick="act('/set-event-code',{code:document.getElementById('codeI').value})">OK</button>
                <hr>
                <button onclick="act('/toggle-event',{state:false})" style="background:orange;padding:10px;color:white;border:none;border-radius:5px;">VERROUILLER ÉVÉNEMENT</button>
                <button onclick="if(confirm('Tout effacer?'))fetch('/admin/reset',{method:'POST'}).then(()=>location.reload())" style="background:red;color:white;padding:10px;border:none;border-radius:5px;">RESET PHOTOS</button>
            </div>
        </div>

        <script src="/socket.io/socket.io.js"></script>
        <script>
            const socket=io();
            function showMainTab(m){ document.getElementById('main-photos').style.display=m==='photos'?'block':'none'; document.getElementById('main-sys').style.display=m==='sys'?'block':'none'; }
            function showTab(t){ document.querySelectorAll('.tab-content').forEach(el=>el.style.display='none'); document.getElementById('tab-'+t).style.display='block'; }
            function act(r,d){ fetch(r,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}); }
            
            socket.on('init_admin',d=>{
                document.getElementById('autoCheck').checked=d.autoApprove;
                document.getElementById('vitesse').value=d.slideDuration/1000;
                document.getElementById('effet').value=d.transitionType;
                document.getElementById('codeI').value=d.eventCode;
                document.getElementById('nb-oui').innerText=d.approved.length;
                document.getElementById('nb-non').innerText=d.rejected.length;

                ['approved','rejected','trashed'].forEach(type=>{
                    const l=document.getElementById('list-'+type); l.innerHTML="";
                    d[type].forEach(p=>{
                        const div=document.createElement('div'); div.style="background:white;padding:5px;border-radius:5px;width:90px;text-align:center;";
                        let btns = '';
                        if(type!=='approved') btns += '<button onclick="act(\\'/approve\\',{url:\\''+p.url+'\\',user:\\''+p.user+'\\'})" style="background:green;color:white;width:100%;font-size:9px;">OUI</button>';
                        if(type!=='rejected') btns += '<button onclick="act(\\'/reject\\',{url:\\''+p.url+'\\',user:\\''+p.user+'\\'})" style="background:orange;width:100%;font-size:9px;">NON</button>';
                        if(type!=='trashed') btns += '<button onclick="act(\\'/delete\\',{url:\\''+p.url+'\\'})" style="background:black;color:white;width:100%;font-size:9px;">🗑️</button>';
                        div.innerHTML='<img src="'+p.url+'" style="width:100%;height:60px;object-fit:cover;">' + btns;
                        l.appendChild(div);
                    });
                });
            });

            socket.on('new_photo_pending',p=>{
                const l=document.getElementById('list-pending');
                const div=document.createElement('div'); div.style="background:white;padding:8px;border-radius:10px;width:120px;border:2px solid #007bff;";
                div.innerHTML='<img src="'+p.url+'" style="width:100%;"><br><div style="display:flex;gap:2px;"><button onclick="act(\\'/approve\\',{url:\\''+p.url+'\\',user:\\''+p.user+'\\'});this.parentElement.parentElement.remove()" style="background:green;color:white;flex:1;">OUI</button><button onclick="act(\\'/reject\\',{url:\\''+p.url+'\\',user:\\''+p.user+'\\'});this.parentElement.parentElement.remove()" style="background:red;color:white;flex:1;">NON</button></div>';
                l.prepend(div);
            });
        </script>
    </body></html>`);
});

// --- LOGIQUE ACTIONS ---
app.post('/approve', checkAuth, (req, res) => {
    const p = req.body;
    rejectedPhotos = rejectedPhotos.filter(x => x.url !== p.url);
    trashedPhotos = trashedPhotos.filter(x => x.url !== p.url);
    if(!approvedPhotos.some(x => x.url === p.url)) approvedPhotos.push(p);
    refreshAll(); res.sendStatus(200);
});
app.post('/reject', checkAuth, (req, res) => {
    const p = req.body;
    approvedPhotos = approvedPhotos.filter(x => x.url !== p.url);
    trashedPhotos = trashedPhotos.filter(x => x.url !== p.url);
    if(!rejectedPhotos.some(x => x.url === p.url)) rejectedPhotos.push(p);
    refreshAll(); res.sendStatus(200);
});
app.post('/delete', checkAuth, (req, res) => {
    const p = req.body;
    approvedPhotos = approvedPhotos.filter(x => x.url !== p.url);
    rejectedPhotos = rejectedPhotos.filter(x => x.url !== p.url);
    if(!trashedPhotos.some(x => x.url === p.url)) trashedPhotos.push(p);
    refreshAll(); res.sendStatus(200);
});
app.get('/admin/download-zip', checkAuth, async (req, res) => {
    const zip = new JSZip();
    approvedPhotos.forEach(p => {
        const fPath = path.join(publicPath, p.url);
        if (fs.existsSync(fPath)) zip.file(path.basename(p.url), fs.readFileSync(fPath));
    });
    const content = await zip.generateAsync({ type: "nodebuffer" });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=evenement.zip');
    res.send(content);
});
app.post('/set-transition', checkAuth, (req, res) => { transitionType = req.body.type; refreshAll(); res.sendStatus(200); });
app.post('/set-duration', checkAuth, (req, res) => { slideDuration = parseInt(req.body.duration); refreshAll(); res.sendStatus(200); });
app.post('/set-event-code', checkAuth, (req, res) => { eventCode = req.body.code; refreshAll(); res.sendStatus(200); });
app.post('/toggle-auto', checkAuth, (req, res) => { autoApprove = req.body.state; refreshAll(); res.sendStatus(200); });
app.post('/toggle-event', checkAuth, (req, res) => { isEventActive = req.body.state; refreshAll(); res.sendStatus(200); });
app.post('/admin/reset', checkAuth, (req, res) => { approvedPhotos = []; rejectedPhotos = []; trashedPhotos = []; refreshAll(); res.sendStatus(200); });

// --- DIAPORAMA (RETRO) ---
app.get('/retro', (req, res) => {
    res.send(`<!DOCTYPE html><html><body style="background:black;margin:0;overflow:hidden;font-family:sans-serif;">
        <div id="start-btn" style="position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:100;display:flex;align-items:center;justify-content:center;">
            <button onclick="start()" style="padding:20px 40px;font-size:22px;background:#28a745;color:white;border:none;border-radius:50px;cursor:pointer;font-weight:bold;">LANCER LE DIAPORAMA</button>
        </div>
        <div id="main" style="height:100vh;width:100vw;position:relative;">
            <img id="img1" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;">
            <img id="img2" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;">
            <div id="tag" style="position:absolute;bottom:50px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.7);color:white;padding:12px 35px;border-radius:40px;font-size:30px;z-index:10;display:none;"></div>
            <div style="position:absolute;bottom:20px;right:20px;background:white;padding:10px;border-radius:15px;text-align:center;z-index:20;">
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${req.protocol}://${req.get('host')}/" style="width:80px;">
                <div id="code-disp" style="color:#28a745;font-weight:900;font-size:18px;"></div>
            </div>
        </div>
        <script src="/socket.io/socket.io.js"></script>
        <script>
            const socket=io({query:{page:'retro',name:'Ecran'}});
            let list=[], cur=0, timer=null, currentDuration=7000, currentMode='crossfade', activeIdx=1;

            function loop(){
                if(!list.length) return;
                const i1=document.getElementById('img1'), i2=document.getElementById('img2'), tag=document.getElementById('tag');
                const inc=activeIdx===1?i1:i2, out=activeIdx===1?i2:i1;

                if(currentMode==='instant'){
                    inc.style.transition='none'; out.style.transition='none';
                    inc.src=list[cur].url; inc.style.opacity=1; out.style.opacity=0;
                } else if(currentMode==='fade-to-black'){
                    out.style.transition='opacity 0.8s'; inc.style.transition='opacity 0.8s';
                    out.style.opacity=0;
                    setTimeout(()=>{ inc.src=list[cur].url; inc.style.opacity=1; }, 800);
                } else {
                    inc.style.transition='opacity 1.5s'; out.style.transition='opacity 1.5s';
                    inc.src=list[cur].url; inc.style.opacity=1; out.style.opacity=0;
                }
                tag.style.display='block'; tag.innerText="📸 "+list[cur].user;
                cur=(cur+1)%list.length; activeIdx=activeIdx===1?2:1;
            }

            function start(){
                document.getElementById('start-btn').style.display='none';
                if(document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
                if(list.length){ loop(); timer=setInterval(loop, currentDuration); }
            }

            socket.on('init_photos',d=>{
                list=d.photos; currentMode=d.transitionType;
                if(currentDuration!==d.duration){
                    currentDuration=d.duration;
                    if(timer){ clearInterval(timer); timer=setInterval(loop, currentDuration); }
                }
            });
            socket.on('init_admin',d=>{ document.getElementById('code-disp').innerText=d.eventCode; });
        </script>
    </body></html>`);
});

server.listen(PORT, () => { console.log("🚀 Connecté sur le port " + PORT); });
