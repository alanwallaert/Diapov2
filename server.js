app.get('/retro', (req, res) => {
    res.send(`
        <body style="background:black; color:white; margin:0; overflow:hidden; font-family:sans-serif; text-align:center; cursor: pointer;" onclick="toggleFS()">
            <div id="start-btn" style="position:fixed; inset:0; background:rgba(0,0,0,0.95); z-index:100; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                <button onclick="start(event)" style="padding:20px 40px; font-size:22px; border-radius:40px; background:#28a745; color:white; border:none; cursor:pointer; font-weight:bold;">📽️ LANCER LE DIAPORAMA</button>
            </div>

            <div id="main" style="height:100vh; display:flex; align-items:center; justify-content:center; position:relative;">
                <h1 id="msg">En attente de photos...</h1>
                <img id="img" style="max-width:100%; max-height:100vh; display:none; transition: opacity 1s; object-fit: contain;">
                
                <div id="tag" style="position:absolute; bottom:50px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.7); padding:10px 30px; border-radius:30px; font-size:30px; display:none; z-index:10;"></div>

                <div id="qr-container" style="position:absolute; bottom:20px; right:20px; background:white; padding:10px; border-radius:15px; display:flex; flex-direction:column; align-items:center; box-shadow: 0 0 20px rgba(0,0,0,0.5); z-index:20;">
                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=https://diapov2.onrender.com/" style="width:100px; height:100px;">
                    <span style="color:black; font-size:12px; font-weight:bold; margin-top:5px;">SCANNEZ-MOI !</span>
                </div>
            </div>

            <script src="/socket.io/socket.io.js"></script>
            <script>
                const socket = io({ query: { page: 'retro', name: 'Écran Diapo' } });
                let list = []; let cur = 0; let t = null; let currentDuration = 7000;

                function toggleFS() { 
                    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(e => {}); 
                }

                socket.on('init_photos', (data) => { 
                    list = data.photos; 
                    currentDuration = data.duration;
                    if (t) { clearInterval(t); t = setInterval(loop, currentDuration); }
                });

                function start(e) { 
                    e.stopPropagation(); 
                    toggleFS(); 
                    document.getElementById('start-btn').style.display='none'; 
                    if(list.length) loop(); 
                }

                function loop() {
                    const i = document.getElementById('img'); 
                    const tag = document.getElementById('tag');
                    if(!list.length) return;

                    document.getElementById('msg').style.display='none'; 
                    i.style.display='block'; 
                    tag.style.display='block'; 
                    i.style.opacity = 0;

                    setTimeout(() => { 
                        i.src = list[cur].url; 
                        tag.innerText = "📸 " + list[cur].user; 
                        i.style.opacity = 1; 
                        cur = (cur + 1) % list.length; 
                    }, 100);

                    if(!t) t = setInterval(loop, currentDuration);
                }
            </script>
        </body>
    `);
});
