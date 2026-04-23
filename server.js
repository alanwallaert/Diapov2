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

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const DB_FILE = './database.json';
const USERS_FILE = './users.json';

let approvedPhotos = []; 
let rejectedPhotos = []; 
let trashedPhotos = [];
let autoApprove = false;
let slideDuration = 7000;
let transitionType = "crossfade"; // crossfade, fade-to-black, instant
let eventCode = "1234"; 
let isEventActive = true; 
let activeClients = {};

// --- PERSISTENCE ---
function loadDB() {
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
}

function saveDB() {
    const data = { approved: approvedPhotos, rejected: rejectedPhotos, trashed: trashedPhotos, autoApprove, slideDuration, transitionType, eventCode, isEventActive };
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

loadDB();

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

// --- ROUTES ---
app.post('/verify-code', (req, res) => { if (req.body.code === eventCode) { req.session.hasAccess = true; res.sendStatus(200); } else res.sendStatus(403); });
app.get('/login', (req, res) => { res.send(`<body style="background:#121212;color:white;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;"><form action="/login" method="POST" style="background:#1e1e1e;padding:30px;border-radius:15px;"><input type="text" name="userid" placeholder="ID" required style="margin-bottom:10px;display:block;"><input type="password" name="password" placeholder="PASS" required style="margin-bottom:10px;display:block;"><button type="submit">ADMIN</button></form></body>`); });
app.post('/login', (req, res) => {
    const users = JSON.parse(fs.readFileSync(USERS_FILE));
    const user = users.find(u => u.id === req.body.userid);
    if (user && bcrypt.compareSync(req.body.password, user.pass)) { req.session.user = user.id; res.redirect('/admin'); } else res.redirect('/login');
});
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// --- ACCUEIL & UPLOAD ---
app.get('/', checkEventAccess, (req, res) => {
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Photo</title></head><body style="font-family:sans-serif;background:#121212;color:white;text-align:center;padding:20px;margin:0;"><div style="background:#1e1e1e;padding:25px;border-radius:20px;max-width:400px;margin:auto;"><h2>📸 Partager une Photo</h2><input type="text" id="user" oninput="localStorage.setItem('p_name', this.value)" placeholder="Prénom" style="width:100%;padding:15px;margin-bottom:20px;border-radius:10px;border:none;background:#333;color:white;"><div style="display:flex;flex-direction:column;gap:15px;"><label style="background:#007bff;padding:20px;border-radius:15px;cursor:pointer;">📷 PHOTO<input type="file" id="file_cam" accept="image/*" capture="camera" style="display:none;" onchange="this.previousSibling.textContent='✅ PHOTO OK'"></label><label style="background:#444;padding:20px;border-radius:15px;cursor:pointer;">📁 GALERIE<input type="file" id="file_album" accept="image/*" style="display:none;" onchange="this.previousSibling.textContent='✅ IMAGE OK'"></label></div><button id="s" onclick="send()" style="width:100%;padding:20px;background:#28a745;color:white;border:none;border-radius:12px;margin-top:30px;font-weight:bold;">ENVOYER</button></div><script>async function send(){const c=document.getElementById('file_cam').files[0],a=document.getElementById('file_album').files[0],f=c||a,u=document.getElementById('user').value;if(!f||!u)return alert("Nom + Photo !");const b=document.getElementById('s');b.disabled=true;b.innerText='ENVOI...';const fd=new FormData();fd.append('photo',f);fd.append('username',u);await fetch('/upload',{method:'POST',body:fd});alert("Merci !");location.reload();}</script></body></html>`);
});

app.post('/upload', upload.single('photo'), (req, res) => {
    const data = { url: '/uploads/'+req.file.filename, user: req.body.username };
    if (autoApprove) { approvedPhotos.push(data); saveDB(); refreshAll(); }
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
            <h2 style="margin:0;">🛡️ Admin</h2>
            <div style="display:flex;gap:10px;">
                <button onclick="showTab('photos')">PHOTOS</button>
                <button onclick="showTab('sys')">CONFIG</button>
                <a href="/logout" style="background:red;color:white;padding:5px;border-radius:5px;text-decoration:none;">QUIT</a>
            </div>
        </div>

        <div id="tab-photos">
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:15px;">
                <div style="background:white;padding:10px;border-radius:10px;">AUTO: <input type="checkbox" id="autoCheck" onchange="act('/toggle-auto',{state:this.checked})"></div>
                <div style="background:white;padding:10px;border-radius:10px;">TEMPS: <input type="number" id="slideInput" style="width:40px" onchange="act('/set-duration',{duration:this.value*1000})">s</div>
                <div style="background:white;padding:10px;border-radius:10px;">EFFET: <select id="transInput" onchange="act('/set-transition',{type:this.value})"><option value="crossfade">Croisé</option><option value="fade-to-black">Noir</option><option value="instant">Flash</option></select></div>
            </div>
            <div id="pending" style="display:flex;gap:10px;overflow-x:auto;padding:15px;background:#e3f2fd;margin-top:15px;border-radius:10px;min-height:50px;"></div>
            <div id="list-approved" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:15px;"></div>
        </div>

        <div id="tab-sys" style="display:none;margin-top:15px;">
            <div style="background:white;padding:20px;border-radius:15px;">
                CODE ACCÈS: <input type="text" id="codeInp" style="width:100px"><button onclick="act('/set-event-code',{code:document.getElementById('codeInp').value})">OK</button>
                <hr><button onclick="if(confirm('Tout effacer?'))fetch('/admin/reset',{method:'POST'}).then(()=>location.reload())" style="background:red;color:white;width:100%;padding:15px;border:none;border-radius:10px;font-weight:bold;">RÉINITIALISER TOUT</button>
            </div>
        </div>

        <script src="/socket.io/socket.io.js"></script>
        <script>
            const socket=io();
            function showTab(t){ document.getElementById('tab-photos').style.display=t==='photos'?'block':'none'; document.getElementById('tab-sys').style.display=t==='sys'?'block':'none'; }
            function act(r,d){ fetch(r,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}); }
            
            socket.on('init_admin',d=>{
                document.getElementById('autoCheck').checked=d.autoApprove;
                document.getElementById('slideInput').value=d.slideDuration/1000;
                document.getElementById('transInput').value=d.transitionType;
                document.getElementById('codeInp').value=d.eventCode;
                const l=document.getElementById('list-approved'); l.innerHTML="";
                d.approved.forEach(p=>{
                    const div=document.createElement('div'); div.style="background:white;padding:5px;border-radius:5px;width:90px;text-align:center;";
                    div.innerHTML='<img src="'+p.url+'" style="width:100%;height:60px;object-fit:cover;"><button onclick="act(\\'/delete\\',\\''+p.url+'\\')" style="background:black;color:white;width:100%;font-size:10px;">SUPPR</button>';
                    l.appendChild(div);
                });
            });

            socket.on('new_photo_pending',p=>{
                const l=document.getElementById('pending');
                const div=document.createElement('div'); div.style="background:white;padding:5px;border-radius:8px;min-width:100px;";
                div.innerHTML='<img src="'+p.url+'" style="width:100%;"><br><button onclick="act(\\'/approve\\',\\''+p.url+'\\',\\''+p.user+'\\');this.parentElement.remove()" style="background:green;color:white;width:48%;">OK</button><button onclick="act(\\'/reject\\',\\''+p.url+'\\',\\''+p.user+'\\');this.parentElement.remove()" style="background:red;color:white;width:48%;">X</button>';
                l.prepend(div);
            });
            function act(r,p,usr){
                let body = typeof p === 'string' ? {url:p, user:usr} : p;
                fetch(r,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
            }
        </script>
    </body></html>`);
});

// --- ACTIONS ADMIN ---
app.post('/approve', checkAuth, (req, res) => {
    const p = req.body;
    if(!approvedPhotos.some(x => x.url === p.url)) approvedPhotos.push(p);
    saveDB(); refreshAll(); res.sendStatus(200);
});
app.post('/delete', checkAuth, (req, res) => {
    approvedPhotos = approvedPhotos.filter(x => x.url !== req.body.url);
    saveDB(); refreshAll(); res.sendStatus(200);
});
app.post('/set-transition', checkAuth, (req, res) => { transitionType = req.body.type; saveDB(); refreshAll(); res.sendStatus(200); });
app.post('/set-duration', checkAuth, (req, res) => { slideDuration = parseInt(req.body.duration); saveDB(); refreshAll(); res.sendStatus(200); });
app.post('/set-event-code', checkAuth, (req, res) => { eventCode = req.body.code; saveDB(); refreshAll(); res.sendStatus(200); });
app.post('/toggle-auto', checkAuth, (req, res) => { autoApprove = req.body.state; saveDB(); refreshAll(); res.sendStatus(200); });
app.post('/admin/reset', checkAuth, (req, res) => { approvedPhotos = []; saveDB(); refreshAll(); res.sendStatus(200); });

// --- DIAPORAMA (RETRO) ---
app.get('/retro', (req, res) => {
    res.send(`<!DOCTYPE html><html><body style="background:black;margin:0;overflow:hidden;font-family:sans-serif;">
        <div id="start-btn" style="position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:100;display:flex;align-items:center;justify-content:center;">
            <button onclick="start()" style="padding:20px 40px;font-size:22px;background:#28a745;color:white;border:none;border-radius:50px;cursor:pointer;font-weight:bold;">LANCER LE DIAPORAMA</button>
        </div>
        <div id="main" style="height:100vh;width:100vw;position:relative;background:black;">
            <img id="img1" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;">
            <img id="img2" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;">
            <div id="tag" style="position:absolute;bottom:50px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.7);color:white;padding:12px 35px;border-radius:40px;font-size:30px;z-index:10;display:none;border:1px solid rgba(255,255,255,0.2);"></div>
            <div style="position:absolute;bottom:20px;right:20px;background:white;padding:10px;border-radius:15px;text-align:center;z-index:10;box-shadow:0 0 20px rgba(0,0,0,0.5);">
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${req.protocol}://${req.get('host')}/" style="width:90px;">
                <div id="code-disp" style="color:#28a745;font-weight:900;font-size:18px;"></div>
            </div>
        </div>
        <script src="/socket.io/socket.io.js"></script>
        <script>
            const socket=io({query:{page:'retro',name:'Ecran'}});
            let list=[], cur=0, timer=null, currentDuration=7000, currentMode='crossfade', activeIdx=1;

            function loop(){
                if(!list.length) return;
                const img1=document.getElementById('img1'), img2=document.getElementById('img2'), tag=document.getElementById('tag');
                const incoming = activeIdx===1?img1:img2, outgoing = activeIdx===1?img2:img1;

                if(currentMode==='instant'){
                    incoming.style.transition='none'; outgoing.style.transition='none';
                    incoming.src=list[cur].url; incoming.style.opacity=1; outgoing.style.opacity=0;
                } else if(currentMode==='fade-to-black'){
                    outgoing.style.transition='opacity 0.8s'; incoming.style.transition='opacity 0.8s';
                    outgoing.style.opacity=0;
                    setTimeout(()=>{ incoming.src=list[cur].url; incoming.style.opacity=1; }, 800);
                } else {
                    incoming.style.transition='opacity 1.5s'; outgoing.style.transition='opacity 1.5s';
                    incoming.src=list[cur].url; incoming.style.opacity=1; outgoing.style.opacity=0;
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

server.listen(PORT, () => { console.log("🚀 Serveur prêt sur le port " + PORT); });
