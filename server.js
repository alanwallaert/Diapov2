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
app.get('/login', (req, res) => { res.send(`<body style="background:#121212;color:white;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;"><form action="/login" method="POST" style="background:#1e1e1e;padding:30px;border-radius:15px;text-align:center;"><h2>Admin Login</h2><input type="text" name="userid" placeholder="ID" required style="display:block;margin:10px auto;padding:10px;"><input type="password" name="password" placeholder="PASS" required style="display:block;margin:10px auto;padding:10px;"><button type="submit" style="padding:10px 20px;background:#28a745;color:white;border:none;border-radius:5px;">CONNEXION</button></form></body>`); });
app.post('/login', (req, res) => {
    const users = JSON.parse(fs.readFileSync(USERS_FILE));
    const user = users.find(u => u.id === req.body.userid);
    if (user && bcrypt.compareSync(req.body.password, user.pass)) { req.session.user = user.id; res.redirect('/admin'); } else res.redirect('/login');
});
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// --- ADMIN PAGE ---
app.get('/admin', checkAuth, (req, res) => {
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Admin</title></head>
    <body style="font-family:sans-serif; background:#f0f2f5; margin:0; padding:15px;">
        <div style="background:white; padding:15px; border-radius:15px; display:flex; justify-content:space-between; align-items:center; box-shadow:0 2px 10px rgba(0,0,0,0.1); margin-bottom:15px;">
            <div style="display:flex; align-items:center; gap:10px;">
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${req.protocol}://${req.get('host')}/" style="width:50px; border-radius:5px;">
                <h1 style="margin:0; font-size:18px;">🛡️ Admin</h1>
            </div>
            
            <div onclick="document.getElementById('userModal').style.display='flex'" style="background:#e1f5fe; padding:8px 15px; border-radius:20px; cursor:pointer; text-align:center; border:1px solid #01579b;">
                <span style="color:#01579b; font-weight:bold; font-size:11px;">👥 CONNECTÉS</span><br>
                <span id="total-online" style="font-size:18px; font-weight:bold; color:#01579b;">0</span>
            </div>

            <div style="display:flex; gap:8px;">
                <button onclick="showMainTab('photos')" style="padding:8px; border-radius:8px; border:none; background:#444; color:white; cursor:pointer;">PHOTOS</button>
                <button onclick="showMainTab('sys')" style="padding:8px; border-radius:8px; border:none; background:#444; color:white; cursor:pointer;">SYSTÈME</button>
                <a href="/logout" style="background:#dc3545; color:white; padding:8px 12px; border-radius:8px; text-decoration:none; font-weight:bold;">X</a>
            </div>
        </div>

        <div id="userModal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.8); z-index:1000; align-items:center; justify-content:center; padding:20px;" onclick="this.style.display='none'">
            <div style="background:white; width:100%; max-width:400px; border-radius:15px; padding:20px;" onclick="event.stopPropagation()">
                <h2 style="margin-top:0;">Utilisateurs en ligne</h2>
                <div id="user-details" style="max-height:300px; overflow-y:auto;"></div>
                <button onclick="document.getElementById('userModal').style.display='none'" style="width:100%; margin-top:20px; padding:12px; background:#444; color:white; border:none; border-radius:8px;">FERMER</button>
            </div>
        </div>

        <div id="main-photos">
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:15px;">
                <div style="background:#fff; padding:12px; border-radius:10px; border:2px solid #28a745; display:flex; align-items:center; justify-content:space-between;">
                    <span style="font-weight:bold; color:#28a745; font-size:12px;">🚀 AUTO</span>
                    <input type="checkbox" id="autoCheck" onchange="act('/toggle-auto',{state:this.checked})">
                </div>
                <div style="background:#fff; padding:12px; border-radius:10px; border:2px solid #007bff;">
                    <span style="font-weight:bold; color:#007bff; font-size:11px;">⏱️ VITESSE : <span id="valDur">7</span>s</span>
                    <input type="range" min="2" max="30" value="7" id="durRange" style="width:100%;" oninput="document.getElementById('valDur').innerText=this.value" onchange="act('/set-duration',{duration:this.value*1000})">
                </div>
            </div>

            <div style="background:#fff; padding:12px; border-radius:10px; border:2px solid #6f42c1; margin-bottom:15px; display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:bold; color:#6f42c1; font-size:12px;">🎬 EFFET TRANSITION</span>
                <select id="effet" onchange="act('/set-transition',{type:this.value})" style="padding:5px; border-radius:5px;">
                    <option value="crossfade">Fondu Croisé</option>
                    <option value="fade-to-black">Passage au Noir</option>
                    <option value="instant">Instantané</option>
                </select>
            </div>

            <button onclick="location.href='/admin/download-zip'" style="width:100%; padding:15px; background:#6f42c1; color:white; border:none; border-radius:10px; font-weight:bold; margin-bottom:15px; cursor:pointer; box-shadow: 0 4px 0 #59359a;">📥 TÉLÉCHARGER TOUT (ZIP)</button>

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

        <div id="main-sys" style="display:none; margin-top:15px;">
            <div style="background:white; padding:20px; border-radius:15px; border:1px solid #eee;">
                <h3 style="margin-top:0; color:#007bff;">📱 PARAMÈTRES MOBILE</h3>
                <div style="display:flex; align-items:center; gap:15px; margin-bottom:20px;">
                    <label style="font-weight:bold; flex:1;">Code d'accès Invités :</label>
                    <input type="text" id="codeI" style="padding:10px; border-radius:8px; border:1px solid #ddd; width:100px; text-align:center; font-weight:bold;">
                    <button onclick="act('/set-event-code',{code:document.getElementById('codeI').value})" style="padding:10px 20px; background:#28a745; color:white; border:none; border-radius:8px;">OK</button>
                </div>
                <hr style="border:0; border-top:1px solid #eee; margin:20px 0;">
                <button onclick="toggleEvt()" id="evtBtn" style="width:100%; padding:15px; border-radius:10px; border:none; color:white; font-weight:bold; cursor:pointer;"></button>
                <br><br>
                <button onclick="if(confirm('Tout effacer?'))act('/admin/reset',{})" style="width:100%; padding:15px; background:#dc3545; color:white; border:none; border-radius:10px; font-weight:bold;">RÉINITIALISER TOUT</button>
            </div>
        </div>

        <script src="/socket.io/socket.io.js"></script>
        <script>
            const socket=io();
            let currentEvt = true;

            function showMainTab(m){ document.getElementById('main-photos').style.display=m==='photos'?'block':'none'; document.getElementById('main-sys').style.display=m==='sys'?'block':'none'; }
            function showTab(t){ 
                document.querySelectorAll('.tab-content').forEach(el=>el.style.display='none'); 
                document.querySelectorAll('button[id^="btn-"]').forEach(b=>{b.style.background='#ddd'; b.style.color='black'});
                document.getElementById('tab-'+t).style.display='block';
                const active = document.getElementById('btn-'+t);
                active.style.background = (t==='pending'?'#007bff':(t==='approved'?'#28a745':(t==='rejected'?'#ffc107':'#000')));
                active.style.color = 'white';
            }
            function act(r,d){ fetch(r,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}); }
            function toggleEvt(){ currentEvt = !currentEvt; act('/toggle-event',{state:currentEvt}); }

            socket.on('init_admin', d => {
                const total = d.stats.home.length + d.stats.gallery.length + d.stats.retro.length;
                document.getElementById('total-online').innerText = total;
                document.getElementById('user-details').innerHTML = \`<b>🏠 Accueil:</b> \${d.stats.home.join(', ') || 'aucun'}<br><b>🖼 Galerie:</b> \${d.stats.gallery.join(', ') || 'aucun'}<br><b>📽 Diapo:</b> \${d.stats.retro.join(', ') || 'aucun'}\`;
                
                document.getElementById('autoCheck').checked = d.autoApprove;
                document.getElementById('durRange').value = d.slideDuration/1000;
                document.getElementById('valDur').innerText = d.slideDuration/1000;
                document.getElementById('effet').value = d.transitionType;
                document.getElementById('codeI').value = d.eventCode;
                document.getElementById('nb-oui').innerText = d.approved.length;
                document.getElementById('nb-non').innerText = d.rejected.length;
                
                currentEvt = d.isEventActive;
                const eB = document.getElementById('evtBtn');
                eB.innerText = currentEvt ? "FERMER L'ÉVÉNEMENT" : "OUVRIR L'ÉVÉNEMENT";
                eB.style.background = currentEvt ? "#dc3545" : "#28a745";

                ['approved','rejected','trashed'].forEach(type => {
                    const l = document.getElementById('list-'+type); l.innerHTML = "";
                    d[type].forEach(p => {
                        const div = document.createElement('div');
                        div.style = "background:white; padding:5px; border-radius:8px; width:90px; text-align:center; box-shadow:0 1px 3px rgba(0,0,0,0.1);";
                        let b = "";
                        if(type!=='approved') b += '<button onclick="act(\\'/approve\\',{url:\\''+p.url+'\\',user:\\''+p.user+'\\'})" style="background:green;color:white;width:100%;font-size:8px;margin-bottom:2px;">OUI</button>';
                        if(type!=='rejected') b += '<button onclick="act(\\'/reject\\',{url:\\''+p.url+'\\',user:\\''+p.user+'\\'})" style="background:orange;color:white;width:100%;font-size:8px;margin-bottom:2px;">NON</button>';
                        if(type!=='trashed') b += '<button onclick="act(\\'/delete\\',{url:\\''+p.url+'\\'})" style="background:black;color:white;width:100%;font-size:8px;">🗑️</button>';
                        div.innerHTML = '<img src="'+p.url+'" style="width:100%;height:60px;object-fit:cover;border-radius:5px;"><div style="margin-top:5px;">'+b+'</div>';
                        l.appendChild(div);
                    });
                });
            });

            socket.on('new_photo_pending', p => {
                const l = document.getElementById('list-pending');
                const div = document.createElement('div'); div.style = "background:white; padding:10px; border-radius:10px; width:130px; border:2px solid #007bff;";
                div.innerHTML = '<img src="'+p.url+'" style="width:100%; border-radius:5px;"><p style="font-size:10px;margin:5px 0;">'+p.user+'</p>' +
                    '<div style="display:flex;gap:4px;"><button onclick="act(\\'/approve\\',{url:\\''+p.url+'\\',user:\\''+p.user+'\\'});this.closest(\\'div\\').parentElement.remove()" style="background:green;color:white;flex:1;border:none;padding:5px;">OUI</button>' +
                    '<button onclick="act(\\'/reject\\',{url:\\''+p.url+'\\',user:\\''+p.user+'\\'});this.closest(\\'div\\').parentElement.remove()" style="background:red;color:white;flex:1;border:none;padding:5px;">NON</button></div>';
                l.prepend(div);
            });
        </script>
    </body></html>`);
});

// --- ACTIONS POST ---
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
app.post('/admin/reset', checkAuth, (req, res) => { approvedPhotos = []; rejectedPhotos = []; trashedPhotos = []; refreshAll(); res.sendStatus(200); });
app.post('/set-duration', checkAuth, (req, res) => { slideDuration = parseInt(req.body.duration); refreshAll(); res.sendStatus(200); });
app.post('/set-transition', checkAuth, (req, res) => { transitionType = req.body.type; refreshAll(); res.sendStatus(200); });
app.post('/toggle-auto', checkAuth, (req, res) => { autoApprove = req.body.state; refreshAll(); res.sendStatus(200); });
app.post('/toggle-event', checkAuth, (req, res) => { isEventActive = req.body.state; refreshAll(); res.sendStatus(200); });
app.post('/set-event-code', checkAuth, (req, res) => { eventCode = req.body.code; refreshAll(); res.sendStatus(200); });

app.get('/admin/download-zip', checkAuth, async (req, res) => {
    const zip = new JSZip();
    approvedPhotos.forEach(p => {
        const fPath = path.join(publicPath, p.url);
        if (fs.existsSync(fPath)) zip.file(path.basename(p.url), fs.readFileSync(fPath));
    });
    const content = await zip.generateAsync({ type: "nodebuffer" });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=photos_event.zip');
    res.send(content);
});

// --- CLIENT & RETRO ---
app.post('/upload', upload.single('photo'), (req, res) => {
    const data = { url: '/uploads/'+req.file.filename, user: req.body.username };
    if (autoApprove) { approvedPhotos.push(data); refreshAll(); }
    else io.emit('new_photo_pending', data);
    res.sendStatus(200);
});

app.get('/', (req, res) => {
    if(!isEventActive) return res.send("<body style='background:black;color:white;text-align:center;'><h1>L'événement est fermé.</h1></body>");
    res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;background:#121212;color:white;text-align:center;padding:20px;">
        <div style="background:#1e1e1e;padding:25px;border-radius:20px;max-width:400px;margin:auto;">
            <h2>📸 Partage Photo</h2>
            <input type="text" id="user" oninput="localStorage.setItem('p_name', this.value)" placeholder="Prénom" style="width:100%;padding:15px;border-radius:10px;border:none;background:#333;color:white;margin-bottom:20px;">
            <label style="background:#007bff;padding:20px;border-radius:15px;display:block;cursor:pointer;font-weight:bold;">📷 PHOTO / GALERIE<input type="file" id="f" accept="image/*" style="display:none;" onchange="document.getElementById('s').innerText='✅ PHOTO PRÊTE'"></label>
            <button id="s" onclick="send()" style="width:100%;padding:20px;background:#28a745;color:white;border:none;border-radius:12px;margin-top:30px;font-weight:bold;cursor:pointer;">ENVOYER</button>
            <button onclick="location.href='/gallery'" style="width:100%;padding:15px;background:transparent;color:#007bff;border:2px solid #007bff;border-radius:12px;margin-top:15px;">VOIR LA GALERIE</button>
        </div>
        <script>
            document.getElementById('user').value = localStorage.getItem('p_name') || '';
            async function send(){
                const f=document.getElementById('f').files[0], u=document.getElementById('user').value;
                if(!f||!u) return alert('Nom + Photo svp');
                const fd=new FormData(); fd.append('photo',f); fd.append('username',u);
                await fetch('/upload',{method:'POST',body:fd}); alert('Envoyé !'); location.reload();
            }
        </script></body></html>`);
});

app.get('/gallery', (req, res) => {
    res.send(`<body style="background:#121212;color:white;text-align:center;padding:20px;"><div id="grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;"></div><script src="/socket.io/socket.io.js"></script><script>const s=io({query:{page:'gallery',name:localStorage.getItem('p_name')||'Anonyme'}});s.on('init_photos',d=>{const g=document.getElementById('grid');g.innerHTML='';d.photos.forEach(p=>{g.innerHTML+='<img src="'+p.url+'" style="width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:10px;">'})});</script></body>`);
});

app.get('/retro', (req, res) => {
    res.send(`<!DOCTYPE html><html><body style="background:black;margin:0;overflow:hidden;"><div id="btn" style="position:fixed;inset:0;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;z-index:100;"><button onclick="start()" style="padding:20px;font-size:20px;border-radius:50px;background:#28a745;color:white;border:none;cursor:pointer;">LANCER DIAPORAMA</button></div>
    <div id="main" style="height:100vh;position:relative;">
        <img id="img1" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;">
        <img id="img2" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;">
        <div id="tag" style="position:absolute;bottom:40px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.7);color:white;padding:10px 30px;border-radius:30px;font-size:30px;z-index:10;"></div>
        <div style="position:absolute;bottom:20px;right:20px;background:white;padding:10px;border-radius:10px;text-align:center;z-index:20;">
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${req.protocol}://${req.get('host')}/" style="width:80px;">
            <div id="c-disp" style="color:#28a745;font-weight:900;"></div>
        </div>
    </div>
    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket=io({query:{page:'retro',name:'Ecran'}});
        let list=[], cur=0, timer=null, dur=7000, mode='crossfade', active=1;
        function loop(){
            if(!list.length) return;
            const i1=document.getElementById('img1'), i2=document.getElementById('img2'), tag=document.getElementById('tag');
            const inc=active===1?i1:i2, out=active===1?i2:i1;
            if(mode==='instant'){ inc.style.transition='none'; out.style.transition='none'; inc.src=list[cur].url; inc.style.opacity=1; out.style.opacity=0; }
            else if(mode==='fade-to-black'){ out.style.opacity=0; setTimeout(()=>{inc.src=list[cur].url; inc.style.opacity=1;},800); }
            else { inc.style.transition='opacity 1.5s'; out.style.transition='opacity 1.5s'; inc.src=list[cur].url; inc.style.opacity=1; out.style.opacity=0; }
            tag.innerText="📸 "+list[cur].user; cur=(cur+1)%list.length; active=active===1?2:1;
        }
        function start(){ document.getElementById('btn').style.display='none'; loop(); timer=setInterval(loop,dur); }
        socket.on('init_photos',d=>{ list=d.photos; mode=d.transitionType; if(dur!==d.duration){ dur=d.duration; if(timer){clearInterval(timer); timer=setInterval(loop,dur);} } });
        socket.on('init_admin',d=>{ document.getElementById('c-disp').innerText=d.eventCode; });
    </script></body></html>`);
});

server.listen(PORT, () => { console.log("🚀 Serveur actif sur port " + PORT); });
