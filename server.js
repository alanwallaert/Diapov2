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

const PORT = process.env.PORT || 3000;
const DB_FILE = './database.json';

// --- STRUCTURE DES DOSSIERS ---
const publicPath = path.join(__dirname, 'public');
const uploadPath = path.join(publicPath, 'uploads');

if (!fs.existsSync(publicPath)) fs.mkdirSync(publicPath);
if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });

// --- ÉTAT DU SYSTÈME ---
let approvedPhotos = [];
let slideDuration = 7000;
let transitionEffect = "fade";

if (fs.existsSync(DB_FILE)) {
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE));
        approvedPhotos = data.approved || [];
        slideDuration = data.slideDuration || 7000;
        transitionEffect = data.transitionEffect || "fade";
    } catch(e) { console.log("Erreur lecture DB"); }
}

function save() {
    fs.writeFileSync(DB_FILE, JSON.stringify({ approved: approvedPhotos, slideDuration, transitionEffect }));
    io.emit('init_photos', { photos: approvedPhotos, duration: slideDuration, effect: transitionEffect });
    io.emit('init_admin', { approved: approvedPhotos, slideDuration, transitionEffect });
}

// --- CONFIGURATION EXPRESS ---
app.use(session({ secret: 'diapo-pro-key', resave: false, saveUninitialized: true }));
app.use(express.json());
app.use(express.static(publicPath));
app.use('/uploads', express.static(uploadPath)); // CRUCIAL pour voir les photos

const upload = multer({ storage: multer.diskStorage({
    destination: uploadPath,
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
})});

// --- ROUTES AUTH ---
app.get('/login', (req, res) => {
    res.send(`<body style="background:#121212;color:white;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
        <form action="/login" method="POST" style="background:#1e1e1e;padding:40px;border-radius:20px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,0.5);">
            <h2 style="color:#28a745;">Accès Admin</h2>
            <input type="password" name="password" placeholder="Code secret" style="width:100%;padding:15px;margin-bottom:20px;border-radius:10px;border:none;background:#333;color:white;text-align:center;font-size:18px;">
            <button type="submit" style="width:100%;padding:15px;background:#28a745;color:white;border:none;border-radius:10px;font-weight:bold;cursor:pointer;">ENTRER</button>
        </form></body>`);
});

app.post('/login', (req, res) => {
    if (req.body.password === "1234") { req.session.user = "admin"; res.redirect('/admin'); }
    else res.send("<script>alert('Faux');window.location='/login'</script>");
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// --- ROUTE ADMIN ---
app.get('/admin', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    res.send(`
    <style>
        body { font-family: sans-serif; background: #f0f2f5; margin: 0; padding: 15px; }
        .nav { display: flex; gap: 10px; margin-bottom: 15px; background: white; padding: 10px; border-radius: 12px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
        .btn { flex: 1; padding: 12px; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; background: #444; color: white; }
        .card { background: white; padding: 20px; border-radius: 15px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; margin-top: 15px; }
        .img-box { position: relative; aspect-ratio: 1; background: #eee; border-radius: 10px; overflow: hidden; }
        .img-box img { width: 100%; height: 100%; object-fit: cover; }
        .del { position: absolute; bottom: 0; width: 100%; background: rgba(220,53,69,0.9); color: white; border: none; padding: 5px; cursor: pointer; font-size: 10px; }
        label { display: block; margin-bottom: 10px; font-weight: bold; color: #555; }
        select, input[type=range] { width: 100%; padding: 10px; margin-bottom: 20px; }
    </style>
    <body>
        <div class="nav">
            <button class="btn" onclick="tab('p')">📸 PHOTOS</button>
            <button class="btn" onclick="tab('s')">⚙️ SYSTÈME</button>
            <button class="btn" style="background:#dc3545; max-width:50px;" onclick="location.href='/logout'">X</button>
        </div>

        <div id="p" class="card">
            <div id="liste" class="grid"></div>
        </div>

        <div id="s" class="card" style="display:none">
            <label>🎬 EFFET DE TRANSITION</label>
            <select id="eff" onchange="act('/set-eff', {val:this.value})">
                <option value="fade">FONDU ENCHAÎNÉ</option>
                <option value="zoom">ZOOM (KEN BURNS)</option>
                <option value="slide">GLISSEMENT</option>
            </select>
            <label>⏱️ VITESSE : <span id="v-val">7</span>s</label>
            <input type="range" min="2" max="20" id="vitesse" oninput="document.getElementById('v-val').innerText=this.value" onchange="act('/set-dur', {val:this.value*1000})">
        </div>

        <script src="/socket.io/socket.io.js"></script>
        <script>
            const socket = io();
            function tab(id) { document.getElementById('p').style.display = id==='p'?'block':'none'; document.getElementById('s').style.display = id==='s'?'block':'none'; }
            function act(route, data) { fetch(route, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)}); }
            
            socket.on('init_admin', d => {
                document.getElementById('eff').value = d.transitionEffect;
                document.getElementById('vitesse').value = d.slideDuration/1000;
                document.getElementById('v-val').innerText = d.slideDuration/1000;
                const list = document.getElementById('liste');
                list.innerHTML = "";
                d.approved.forEach(p => {
                    list.innerHTML += '<div class="img-box"><img src="'+p.url+'"><button class="del" onclick="act(\\'/del\\',{url:\\''+p.url+'\\'})">SUPPRIMER</button></div>';
                });
            });
        </script>
    </body>`);
});

// --- API ADMIN ---
app.post('/set-eff', (req, res) => { transitionEffect = req.body.val; save(); res.sendStatus(200); });
app.post('/set-dur', (req, res) => { slideDuration = req.body.val; save(); res.sendStatus(200); });
app.post('/del', (req, res) => { approvedPhotos = approvedPhotos.filter(p => p.url !== req.body.url); save(); res.sendStatus(200); });

// --- ROUTE ENVOI (PUBLIC) ---
app.get('/', (req, res) => {
    res.send(`<body style="background:#121212;color:white;font-family:sans-serif;text-align:center;padding:20px;margin:0;">
        <div style="max-width:400px;margin:auto;background:#1e1e1e;padding:30px;border-radius:20px;">
            <h2 style="color:#28a745;">📸 PARTAGEZ</h2>
            <input type="text" id="n" placeholder="Votre prénom" style="width:100%;padding:15px;margin-bottom:20px;border-radius:10px;border:none;background:#333;color:white;font-size:16px;">
            <input type="file" id="f" accept="image/*" style="display:none" onchange="up()">
            <button onclick="document.getElementById('f').click()" style="width:100%;padding:20px;background:#28a745;color:white;border:none;border-radius:15px;font-weight:bold;font-size:18px;cursor:pointer;">ENVOYER UNE PHOTO</button>
            <p id="st" style="margin-top:20px;color:#888;"></p>
        </div>
        <script>
            async function up() {
                const n = document.getElementById('n').value;
                if(!n) return alert('Entre ton prénom !');
                const st = document.getElementById('st'); st.innerText = "Envoi en cours...";
                const fd = new FormData();
                fd.append('photo', document.getElementById('f').files[0]);
                fd.append('username', n);
                await fetch('/upload', { method:'POST', body:fd });
                st.innerText = "✅ Reçu ! Regardez l'écran !";
                setTimeout(() => st.innerText = "", 3000);
            }
        </script></body>`);
});

app.post('/upload', upload.single('photo'), (req, res) => {
    if (req.file) {
        approvedPhotos.push({ url: '/uploads/' + req.file.filename, user: req.body.username || "Anonyme" });
        save();
    }
    res.sendStatus(200);
});

// --- ROUTE DIAPORAMA (RETRO) ---
app.get('/retro', (req, res) => {
    res.send(`
    <style>
        body { background: black; margin: 0; overflow: hidden; display: flex; align-items: center; justify-content: center; height: 100vh; }
        .slide { position: absolute; max-width: 100%; max-height: 100%; object-fit: contain; opacity: 0; transition: opacity 1.5s ease-in-out; }
        .active { opacity: 1; z-index: 2; }
        
        /* Effet Zoom */
        .zoom.active { transform: scale(1.15); transition: opacity 1.5s, transform 10s linear; }
        
        /* Effet Slide */
        .slide-eff { transform: translateX(100%); transition: all 1s cubic-bezier(0.4, 0, 0.2, 1); }
        .slide-eff.active { transform: translateX(0); opacity: 1; }
        .slide-eff.exit { transform: translateX(-100%); opacity: 0; }

        #tag { position: absolute; bottom: 30px; background: rgba(0,0,0,0.6); color: white; padding: 10px 30px; border-radius: 50px; font-size: 24px; z-index: 100; font-family: sans-serif; }
    </style>
    <div id="box"></div>
    <div id="tag" style="display:none"></div>
    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        let photos = []; let cur = 0; let dur = 7000; let eff = "fade";
        
        socket.on('init_photos', d => { photos = d.photos; dur = d.duration; eff = d.effect; });

        function showNext() {
            if (photos.length === 0) { setTimeout(showNext, 2000); return; }
            
            const box = document.getElementById('box');
            const tag = document.getElementById('tag');
            const oldImg = box.querySelector('.active');
            
            const img = document.createElement('img');
            img.src = photos[cur].url;
            
            // Appliquer la classe d'effet
            if (eff === 'slide') img.className = 'slide slide-eff';
            else if (eff === 'zoom') img.className = 'slide zoom';
            else img.className = 'slide';

            box.appendChild(img);
            
            setTimeout(() => {
                if (oldImg) {
                    oldImg.classList.remove('active');
                    if (eff === 'slide') oldImg.classList.add('exit');
                    setTimeout(() => oldImg.remove(), 1500);
                }
                img.classList.add('active');
                tag.innerText = "📸 " + photos[cur].user;
                tag.style.display = "block";
                
                cur = (cur + 1) % photos.length;
                setTimeout(showNext, dur);
            }, 100);
        }
        showNext();
    </script>`);
});

io.on('connection', (socket) => {
    socket.emit('init_admin', { approved: approvedPhotos, slideDuration, transitionEffect });
    socket.emit('init_photos', { photos: approvedPhotos, duration: slideDuration, effect: transitionEffect });
});

server.listen(PORT, () => console.log("Lancement OK sur le port " + PORT));
