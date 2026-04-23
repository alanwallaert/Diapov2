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
let autoApprove = false;
let slideDuration = 7000;
let transitionType = "crossfade";
let eventCode = "1234"; 
let isEventActive = true;

// --- PERSISTENCE ---
function loadDB() {
    if (fs.existsSync(DB_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(DB_FILE));
            approvedPhotos = data.approved || [];
            autoApprove = !!data.autoApprove;
            slideDuration = data.slideDuration || 7000;
            transitionType = data.transitionType || "crossfade";
            eventCode = data.eventCode || "1234";
        } catch(e) { console.error("Erreur lecture DB"); }
    }
}
function saveDB() {
    const data = { approved: approvedPhotos, autoApprove, slideDuration, transitionType, eventCode };
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
    if (req.session.hasAccess) return next();
    res.send(`<body style="background:#121212;color:white;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;"><div style="background:#1e1e1e;padding:40px;border-radius:20px;text-align:center;width:300px;"><h2 style="color:#28a745;">Accès Événement</h2><input type="text" id="c" placeholder="CODE" style="width:100%;padding:15px;margin-bottom:20px;border-radius:10px;border:none;background:#333;color:white;text-align:center;font-size:24px;"><button onclick="check()" style="width:100%;padding:15px;background:#28a745;color:white;border:none;border-radius:10px;cursor:pointer;font-weight:bold;">ENTRER</button></div><script>async function check(){const c=document.getElementById('c').value;const r=await fetch('/verify-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:c})});if(r.ok)location.reload();else alert("Code incorrect")}</script></body>`);
};

// --- LOGIQUE SOCKET ---
function refreshAll() {
    saveDB();
    io.emit('init_photos', { photos: approvedPhotos, duration: slideDuration, transitionType });
    io.emit('init_admin', { approved: approvedPhotos, autoApprove, slideDuration, transitionType, eventCode });
}

io.on('connection', (socket) => {
    refreshAll();
});

// --- ROUTES ---
app.post('/verify-code', (req, res) => { if (req.body.code === eventCode) { req.session.hasAccess = true; res.sendStatus(200); } else res.sendStatus(403); });
app.get('/login', (req, res) => { res.send(`<body style="background:#121212;color:white;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;"><form action="/login" method="POST" style="background:#1e1e1e;padding:30px;border-radius:15px;text-align:center;"><h2>Admin</h2><input type="text" name="userid" placeholder="ID" required style="display:block;margin:10px auto;padding:10px;"><input type="password" name="password" placeholder="PASS" required style="display:block;margin:10px auto;padding:10px;"><button type="submit" style="padding:10px 20px;background:#28a745;color:white;border:none;border-radius:5px;cursor:pointer;">CONNEXION</button></form></body>`); });
app.post('/login', (req, res) => {
    const users = JSON.parse(fs.readFileSync(USERS_FILE));
    const user = users.find(u => u.id === req.body.userid);
    if (user && bcrypt.compareSync(req.body.password, user.pass)) { req.session.user = user.id; res.redirect('/admin'); } else res.redirect('/login');
});
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// --- ACCUEIL & GALLERY ---
app.get('/', checkEventAccess, (req, res) => {
    res.send(`<body style="font-family:sans-serif;background:#121212;color:white;text-align:center;padding:20px;margin:0;"><div style="background:#1e1e1e;padding:25px;border-radius:20px;max-width:400px;margin:auto;"><h2>📸 Partager</h2><input type="text" id="user" placeholder="Votre Prénom" style="width:100%;padding:15px;margin-bottom:20px;border-radius:10px;border:none;background:#333;color:white;"><div style="display:flex;flex-direction:column;gap:15px;"><label style="background:#007bff;padding:20px;border-radius:15px;cursor:pointer;font-weight:bold;">📷 PHOTO / GALERIE<input type="file" id="f" accept="image/*" style="display:none;" onchange="document.getElementById('s').innerText='✅ PRÊT'"></label></div><button id="s" onclick="send()" style="width:100%;padding:20px;background:#28a745;color:white;border:none;border-radius:12px;margin-top:30px;font-weight:bold;cursor:pointer;">ENVOYER</button></div><script>async function send(){const f=document.getElementById('f').files[0],u=document.getElementById('user').value;if(!f||!u)return alert("Nom + Photo !");const btn=document.getElementById('s');btn.disabled=true;btn.innerText='ENVOI...';const fd=new FormData();fd.append('photo',f);fd.append('username',u);await fetch('/upload',{method:'POST',body:fd});alert("Envoyé !");location.reload();}</script></body>`);
});

app.post('/upload', upload.single('photo'), (req, res) => {
    const data = { url: '/uploads/'+req.file.filename, user: req.body.username };
    if (autoApprove) { approvedPhotos.push(data); refreshAll(); }
    else io.emit('new_photo_pending', data);
    res.sendStatus(200);
});

// --- ADMIN ---
app.get('/admin', checkAuth, (req, res) => {
    res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f0f2f5;padding:15px;margin:0;">
        <div style="background:white;padding:15px;border-radius:15px;display:flex;justify-content:space-between;align-items:center;box-shadow:0 2px 5px rgba(0,0,0,0.1);">
            <h2 style="margin:0;">🛡️ Panel Admin</h2>
            <div>
                <button onclick="showTab('p')">PHOTOS</button>
                <button onclick="showTab('s')">CONFIG</button>
                <a href="/logout" style="color:red;margin-left:10px;">Quitter</a>
            </div>
        </div>

        <div id="tab-p">
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:15px;">
                <div style="background:white;padding:10px;border-radius:10px;border:2px solid #28a745;">AUTO: <input type="checkbox" id="autoCheck" onchange="act('/toggle-auto',{state:this.checked})"></div>
                <div style="background:white;padding:10px;border-radius:10px;border:2px solid #007bff;">VITESSE: <input type="number" id="vitesse" style="width:40px" onchange="act('/set-duration',{duration:this.value*1000})">s</div>
                <div style="background:white;padding:10px;border-radius:10px;border:2px solid #6f42c1;">EFFET: <select id="effet" onchange="act('/set-transition',{type:this.value})"><option value="crossfade">Croisé</option><option value="fade-to-black">Noir</option><option value="instant">Flash</option></select></div>
            </div>
            <h3 style="color:#007bff;">⏳ EN ATTENTE</h3>
            <div id="pending" style="display:flex;gap:10px;overflow-x:auto;padding:15px;background:#e3f2fd;border-radius:10px;min-height:50px;"></div>
            <h3 style="color:#28a745;">✅ SUR L'ÉCRAN</h3>
            <div id="approved-list" style="display:flex;flex-wrap:wrap;gap:10px;"></div>
        </div>

        <div id="tab-s" style="display:none;margin-top:15px;">
            <div style="background:white;padding:20px;border-radius:15px;">
                CODE ACCÈS: <input type="text" id="codeI" style="width:100px"><button onclick="act('/set-event-code',{code:document.getElementById('codeI').value})">OK</button>
                <hr><button onclick="if(confirm('Reset?'))fetch('/admin/reset',{method:'POST'}).then(()=>location.reload())" style="background:red;color:white;width:100%;padding:15px;border:none;border-radius:10px;cursor:pointer;">VIDER TOUT</button>
            </div>
        </div>

        <script src="/socket.io/socket.io.js"></script>
        <script>
            const socket=io();
            function showTab(t){ document.getElementById('tab-p').style.display=t==='p'?'block':'none'; document.getElementById('tab-s').style.display=t==='s'?'block':'none'; }
            function act(r,d){ fetch(r,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}); }
            
            socket.on('init_admin',d=>{
                document.getElementById('autoCheck').checked=d.autoApprove;
                document.getElementById('vitesse').value=d.slideDuration/1000;
                document.getElementById('effet').value=d.transitionType;
                document.getElementById('codeI').value=d.eventCode;
                const list=document.getElementById('approved-list'); list.innerHTML="";
                d.approved.forEach(p=>{
                    const div=document.createElement('div'); div.style="background:white;padding:5px;border-radius:5px;width:90px;text-align:center;box-shadow:0 2px 4px rgba(0,0,0,0.1);";
                    div.innerHTML='<img src="'+p.url+'" style="width:100%;height:60px;object-fit:cover;border-radius:3px;"><button onclick="act(\\'/delete\\',{url:\\''+p.url+'\\'})" style="background:red;color:white;width:100%;border:none;font-size:10px;margin-top:5px;cursor:pointer;">SUPPR</button>';
                    list.appendChild(div);
                });
            });

            socket.on('new_photo_pending',p=>{
                const div=document.createElement('div'); div.style="background:white;padding:10px;border-radius:10px;min-width:110px;text-align:center;box-shadow:0 4px 8px rgba(0,0,0,0.2);";
                div.innerHTML='<img src="'+p.url+'" style="width:100%;border-radius:5px;"><br><div style="display:flex;gap:5px;margin-top:5px;"><button onclick="act(\\'/approve\\',{url:\\''+p.url+'\\',user:\\''+p.user+'\\'});this.parentElement.parentElement.remove()" style="background:green;color:white;border:none;flex:1;padding:5px;cursor:pointer;">OK</button><button onclick="act(\\'/delete\\',{url:\\''+p.url+'\\'});this.parentElement.parentElement.remove()" style="background:red;color:white;border:none;flex:1;padding:5px;cursor:pointer;">X</button></div>';
                document.getElementById('pending').prepend(div);
            });
        </script>
    </body></html>`);
});

// --- ACTIONS POST ---
app.post('/approve', checkAuth, (req, res) => { approvedPhotos.push(req.body); refreshAll(); res.sendStatus(200); });
app.post('/delete', checkAuth, (req, res) => { approvedPhotos = approvedPhotos.filter(x => x.url !== req.body.url); refreshAll(); res.sendStatus(200); });
app.post('/set-transition', checkAuth, (req, res) => { transitionType = req.body.type; refreshAll(); res.sendStatus(200); });
app.post('/set-duration', checkAuth, (req, res) => { slideDuration = parseInt(req.body.duration); refreshAll(); res.sendStatus(200); });
app.post('/set-event-code', checkAuth, (req, res) => { eventCode = req.body.code; refreshAll(); res.sendStatus(200); });
app.post('/toggle-auto', checkAuth, (req, res) => { autoApprove = req.body.state; refreshAll(); res.sendStatus(200); });
app.post('/admin/reset', checkAuth, (req, res) => { approvedPhotos = []; refreshAll(); res.sendStatus(200); });

// --- DIAPORAMA (RETRO) ---
app.get('/retro', (req, res) => {
    res.send(`<!DOCTYPE html><html><body style="background:black;margin:0;overflow:hidden;font-family:sans-serif;">
        <div id="btn" style="position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:100;display:flex;align-items:center;justify-content:center;">
            <button onclick="start()" style="padding:20px 40px;font-size:22px;background:#28a745;color:white;border:none;border-radius:50px;cursor:pointer;font-weight:bold;">📽️ LANCER LE DIAPORAMA</button>
        </div>
        <div id="main" style="height:100vh;width:100vw;position:relative;background:black;">
            <img id="i1" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;">
            <img id="i2" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;">
            <div id="tag" style="position:absolute;bottom:50px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.7);color:white;padding:12px 35px;border-radius:40px;font-size:30px;z-index:10;display:none;border:1px solid rgba(255,255,255,0.2);"></div>
            <div style="position:absolute;bottom:20px;right:20px;background:white;padding:10px;border-radius:15px;text-align:center;z-index:10;">
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${req.protocol}://${req.get('host')}/" style="width:80px;">
                <div id="c-disp" style="color:#28a745;font-weight:bold;font-size:18px;"></div>
            </div>
        </div>
        <script src="/socket.io/socket.io.js"></script>
        <script>
            const socket=io();
            let list=[], cur=0, timer=null, duration=7000, mode='crossfade', activeIdx=1;

            function loop(){
                if(!list.length) return;
                const i1=document.getElementById('i1'), i2=document.getElementById('i2'), tag=document.getElementById('tag');
                const inc=activeIdx===1?i1:i2, out=activeIdx===1?i2:i1;

                if(mode==='instant'){
                    inc.style.transition='none'; out.style.transition='none';
                    inc.src=list[cur].url; inc.style.opacity=1; out.style.opacity=0;
                } else if(mode==='fade-to-black'){
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
                document.getElementById('btn').style.display='none';
                if(document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
                if(list.length){ loop(); timer=setInterval(loop, duration); }
            }

            socket.on('init_photos',d=>{
                list=d.photos; mode=d.transitionType;
                if(duration!==d.duration){
                    duration=d.duration;
                    if(timer){ clearInterval(timer); timer=setInterval(loop, duration); }
                }
            });
            socket.on('init_admin',d=>{ document.getElementById('c-disp').innerText=d.eventCode; });
        </script>
    </body></html>`);
});

server.listen(PORT, () => { console.log("🚀 Prêt sur le port " + PORT); });
