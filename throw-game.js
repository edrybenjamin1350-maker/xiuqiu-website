(() => {
    'use strict';

    const game = document.getElementById('xiuqiuGame');
    const canvas = document.getElementById('gameCanvas');
    const openButton = document.getElementById('btnGame');
    const closeButton = document.getElementById('gameClose');
    const resetButton = document.getElementById('gameReset');
    const soundButton = document.getElementById('gameSound');
    if (!game || !canvas || !openButton) return;

    const ctx = canvas.getContext('2d');
    const scoreEl = document.getElementById('gameScore');
    const bestEl = document.getElementById('gameBest');
    const angleEl = document.getElementById('gameAngle');
    const powerFill = document.getElementById('gamePowerFill');
    const coach = document.getElementById('gameCoach');
    const message = document.getElementById('gameMessage');

    let width = 0;
    let height = 0;
    let dpr = 1;
    let raf = 0;
    let lastTime = 0;
    let open = false;
    let score = 0;
    let best = Number(localStorage.getItem('xiuqiu-game-best') || 0);
    let state = 'ready';
    let angle = 45;
    let charge = 0;
    let chargeTime = 0;
    let orbit = -.25;
    let pointerId = null;
    let pointerStartY = 0;
    let pointerStartAngle = 45;
    let resetAt = 0;
    let scoreFlash = 0;
    let scenerySeed = 1;
    let audioEnabled = localStorage.getItem('xiuqiu-game-sound') !== 'off';
    let audioContext = null;
    let audioMaster = null;
    let chargeTone = null;
    const ball = {x:0,y:0,px:0,py:0,vx:0,vy:0,r:19,spin:0};
    const hoop = {x:0,y:0,rx:40,ry:46};
    const particles = [];
    const ballSprite = new Image();
    ballSprite.decoding = 'async';
    ballSprite.src = 'assets/xiuqiu-game-sprite.png';

    bestEl.textContent = best;
    updateSoundButton();

    function updateSoundButton(){
        if (!soundButton) return;
        soundButton.classList.toggle('muted', !audioEnabled);
        soundButton.setAttribute('aria-label', audioEnabled ? '关闭音效' : '开启音效');
        soundButton.title = audioEnabled ? '关闭音效' : '开启音效';
    }

    function ensureAudio(){
        if (!audioEnabled) return null;
        const AudioEngine = window.AudioContext || window.webkitAudioContext;
        if (!AudioEngine) return null;
        if (!audioContext) {
            audioContext = new AudioEngine();
            audioMaster = audioContext.createGain();
            audioMaster.gain.value = .58;
            audioMaster.connect(audioContext.destination);
        }
        if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
        return audioContext;
    }

    function playTone(frequency, duration, delay = 0, volume = .08, type = 'sine'){
        const audio = ensureAudio();
        if (!audio || !audioMaster) return;
        const start = audio.currentTime + delay;
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(.0001, start);
        gain.gain.exponentialRampToValueAtTime(volume, start + .018);
        gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
        oscillator.connect(gain).connect(audioMaster);
        oscillator.start(start);
        oscillator.stop(start + duration + .03);
    }

    function startChargeTone(){
        const audio = ensureAudio();
        if (!audio || !audioMaster || chargeTone) return;
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = 'triangle';
        oscillator.frequency.value = 72;
        gain.gain.value = .0001;
        gain.gain.exponentialRampToValueAtTime(.014, audio.currentTime + .08);
        oscillator.connect(gain).connect(audioMaster);
        oscillator.start();
        chargeTone = {oscillator,gain};
    }

    function stopChargeTone(){
        if (!chargeTone || !audioContext) return;
        const tone = chargeTone;
        chargeTone = null;
        tone.gain.gain.cancelScheduledValues(audioContext.currentTime);
        tone.gain.gain.setTargetAtTime(.0001, audioContext.currentTime, .025);
        try { tone.oscillator.stop(audioContext.currentTime + .12); } catch (_) {}
    }

    function playThrowSound(){
        const audio = ensureAudio();
        if (!audio || !audioMaster) return;
        const now = audio.currentTime;
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(520, now);
        oscillator.frequency.exponentialRampToValueAtTime(92, now + .3);
        gain.gain.setValueAtTime(.075, now);
        gain.gain.exponentialRampToValueAtTime(.0001, now + .32);
        oscillator.connect(gain).connect(audioMaster);
        oscillator.start(now);oscillator.stop(now + .34);

        const buffer = audio.createBuffer(1, Math.floor(audio.sampleRate * .22), audio.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i=0;i<data.length;i++) data[i] = (Math.random()*2-1) * Math.pow(1-i/data.length,2);
        const noise = audio.createBufferSource();
        const filter = audio.createBiquadFilter();
        const noiseGain = audio.createGain();
        noise.buffer = buffer;filter.type = 'bandpass';filter.frequency.value = 950;filter.Q.value = .72;noiseGain.gain.value = .11;
        noise.connect(filter).connect(noiseGain).connect(audioMaster);noise.start(now);
    }

    function playScoreSound(){
        [523.25,659.25,783.99,1046.5].forEach((frequency,index) => playTone(frequency,.28,index*.075,.075,'sine'));
    }

    function playMissSound(){
        playTone(135,.22,0,.085,'triangle');
        playTone(78,.3,.1,.065,'sine');
    }

    function clamp(value, min, max){ return Math.max(min, Math.min(max, value)); }
    function groundY(){ return height * .79; }
    function playerX(){ return clamp(width * .105, 56, 145); }
    function handPoint(){ return {x:playerX() + clamp(width * .024, 19, 31), y:groundY() - clamp(height * .135, 91, 116)}; }
    function tetherLength(){ return clamp(Math.min(width,height) * .083, 43, 68); }

    function heldBallPosition(){
        const hand = handPoint();
        return {
            x:hand.x + Math.sin(orbit) * tetherLength(),
            y:hand.y + Math.cos(orbit) * tetherLength()
        };
    }

    function setHoop(first = false){
        const ground = groundY();
        const minSize = Math.min(width,height);
        hoop.rx = clamp(minSize * .052, 29, 47);
        hoop.ry = hoop.rx * 1.08;
        hoop.x = first ? width * .73 : width * (.69 + Math.random() * .13);
        const minLift = height < 560 ? 125 : 155;
        const liftRange = height < 560 ? 70 : 130;
        hoop.y = ground - minLift - Math.random() * liftRange;
        scenerySeed += .73;
    }

    function resize(){
        const rect = canvas.getBoundingClientRect();
        width = Math.max(320, rect.width);
        height = Math.max(420, rect.height);
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        ctx.setTransform(dpr,0,0,dpr,0,0);
        ball.r = clamp(Math.min(width,height) * .035, 20, 29);
        if (state !== 'flying') {
            const held = heldBallPosition();
            ball.x = held.x;
            ball.y = held.y;
        }
        setHoop(true);
    }

    function resetRound(newTarget = false){
        stopChargeTone();
        state = 'ready';
        charge = 0;
        chargeTime = 0;
        orbit = -.25;
        pointerId = null;
        resetAt = 0;
        powerFill.style.height = '0%';
        if (newTarget) setHoop(false);
        const held = heldBallPosition();
        Object.assign(ball,{x:held.x,y:held.y,px:held.x,py:held.y,vx:0,vy:0,spin:0});
    }

    function resetGame(){
        score = 0;
        scoreEl.textContent = '0';
        particles.length = 0;
        setHoop(true);
        resetRound(false);
        showMessage('整装待发');
    }

    function showMessage(text){
        message.textContent = text;
        message.classList.remove('show');
        void message.offsetWidth;
        message.classList.add('show');
    }

    function startCharge(clientY, id = 'keyboard'){
        if (!open || state !== 'ready') return;
        state = 'charging';
        pointerId = id;
        pointerStartY = clientY;
        pointerStartAngle = angle;
        chargeTime = 0;
        coach.classList.add('hide');
        canvas.classList.add('charging');
        startChargeTone();
    }

    function adjustAim(clientY){
        if (state !== 'charging' || pointerId === 'keyboard') return;
        angle = clamp(pointerStartAngle + (pointerStartY - clientY) * .18, 24, 68);
        angleEl.textContent = Math.round(angle) + '°';
    }

    function throwBall(){
        if (state !== 'charging') return;
        stopChargeTone();
        playThrowSound();
        const held = heldBallPosition();
        const radians = angle * Math.PI / 180;
        const baseSpeed = Math.max(420, Math.min(900, width * .62));
        const speed = baseSpeed * (.7 + Math.max(.12, charge) * .48);
        ball.x = held.x;
        ball.y = held.y;
        ball.px = ball.x;
        ball.py = ball.y;
        ball.vx = Math.cos(radians) * speed;
        ball.vy = -Math.sin(radians) * speed;
        state = 'flying';
        pointerId = null;
        canvas.classList.remove('charging');
    }

    function endCharge(id){
        if (state !== 'charging') return;
        if (pointerId !== 'keyboard' && id !== pointerId) return;
        throwBall();
    }

    function openGame(){
        open = true;
        game.classList.add('open');
        game.setAttribute('aria-hidden','false');
        document.body.classList.add('game-open');
        if (typeof stopAuto === 'function' && typeof autoOn !== 'undefined' && autoOn) stopAuto();
        resize();
        resetGame();
        lastTime = performance.now();
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(loop);
        setTimeout(() => canvas.focus({preventScroll:true}), 60);
    }

    function closeGame(){
        stopChargeTone();
        open = false;
        game.classList.remove('open');
        game.setAttribute('aria-hidden','true');
        document.body.classList.remove('game-open');
        canvas.classList.remove('charging');
        cancelAnimationFrame(raf);
    }

    function spawnCelebration(){
        const colors = ['#f4cf6c','#d52e55','#1e9d98','#fff1c4','#ed6d39'];
        for (let i=0;i<34;i++) {
            const a = Math.random() * Math.PI * 2;
            const speed = 70 + Math.random() * 230;
            particles.push({
                x:hoop.x,y:hoop.y,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed-80,
                life:1,size:2+Math.random()*4,color:colors[i%colors.length],rot:Math.random()*6
            });
        }
    }

    function registerScore(){
        if (state !== 'flying') return;
        state = 'scored';
        score += 1;
        scoreEl.textContent = score;
        scoreFlash = 1;
        if (score > best) {
            best = score;
            bestEl.textContent = best;
            localStorage.setItem('xiuqiu-game-best', String(best));
        }
        spawnCelebration();
        playScoreSound();
        showMessage(score === 1 ? '好彩头！' : score % 5 === 0 ? '连中五彩！' : '穿环得分！');
        resetAt = performance.now() + 1000;
    }

    function registerMiss(){
        if (state !== 'flying') return;
        state = 'missed';
        playMissSound();
        showMessage('再试一球');
        resetAt = performance.now() + 780;
    }

    function update(dt, now){
        if (state === 'charging') {
            chargeTime += dt;
            charge = clamp(chargeTime / 1.55, 0, 1);
            const angularSpeed = 2.4 + charge * 9.5;
            if (chargeTone && audioContext) {
                chargeTone.oscillator.frequency.setTargetAtTime(72 + charge * 245, audioContext.currentTime, .035);
                chargeTone.gain.gain.setTargetAtTime(.014 + charge * .036, audioContext.currentTime, .04);
            }
            orbit += angularSpeed * dt;
            const held = heldBallPosition();
            ball.x = held.x;
            ball.y = held.y;
            ball.spin += angularSpeed * dt;
            powerFill.style.height = Math.round(charge * 100) + '%';
        } else if (state === 'ready') {
            orbit = -.25 + Math.sin(now * .002) * .055;
            const held = heldBallPosition();
            ball.x += (held.x-ball.x) * .16;
            ball.y += (held.y-ball.y) * .16;
        } else if (state === 'flying') {
            ball.px = ball.x;
            ball.py = ball.y;
            ball.vy += 900 * dt;
            ball.x += ball.vx * dt;
            ball.y += ball.vy * dt;
            ball.spin += (ball.vx / 62) * dt;

            if (ball.px < hoop.x && ball.x >= hoop.x) {
                const t = (hoop.x-ball.px) / Math.max(.001,ball.x-ball.px);
                const crossY = ball.py + (ball.y-ball.py) * t;
                if (Math.abs(crossY-hoop.y) < hoop.ry-ball.r*.72) registerScore();
            }
            if (state === 'flying' && (ball.y > groundY()-ball.r*.25 || ball.x > width+80 || ball.y < -100)) registerMiss();
        }

        if ((state === 'scored' || state === 'missed') && now >= resetAt) resetRound(state === 'scored');
        particles.forEach(p => {
            p.vy += 420*dt;p.x += p.vx*dt;p.y += p.vy*dt;p.rot += dt*5;p.life -= dt*.95;
        });
        for(let i=particles.length-1;i>=0;i--) if(particles[i].life<=0) particles.splice(i,1);
        scoreFlash = Math.max(0,scoreFlash-dt*2.5);
    }

    function roundedRect(x,y,w,h,r){
        ctx.beginPath();ctx.roundRect(x,y,w,h,r);
    }

    function drawBackground(now){
        const sky = ctx.createLinearGradient(0,0,0,height);
        sky.addColorStop(0,'#315e6d');sky.addColorStop(.48,'#a5c9c6');sky.addColorStop(.8,'#e7d7aa');sky.addColorStop(1,'#8b9b68');
        ctx.fillStyle=sky;ctx.fillRect(0,0,width,height);

        const sunX=width*.78,sunY=height*.2;
        const glow=ctx.createRadialGradient(sunX,sunY,2,sunX,sunY,height*.25);
        glow.addColorStop(0,'rgba(255,238,177,.76)');glow.addColorStop(1,'rgba(255,238,177,0)');
        ctx.fillStyle=glow;ctx.fillRect(0,0,width,height*.58);

        ctx.globalAlpha=.24;ctx.fillStyle='#f8f2db';
        for(let i=0;i<4;i++){
            const x=((i*337+now*.006)% (width+280))-140;
            const y=height*(.16+i*.055);
            ctx.beginPath();ctx.ellipse(x,y,80,15,0,0,Math.PI*2);ctx.ellipse(x+58,y+2,65,11,0,0,Math.PI*2);ctx.fill();
        }
        ctx.globalAlpha=1;

        drawMountain(height*.52,'#73928a',.13,85,scenerySeed);
        drawMountain(height*.61,'#567b72',.2,115,scenerySeed+2);
        drawMountain(height*.7,'#3d675b',.28,75,scenerySeed+4);

        const ground=groundY();
        const earth=ctx.createLinearGradient(0,ground,0,height);
        earth.addColorStop(0,'#596d42');earth.addColorStop(.2,'#344a32');earth.addColorStop(1,'#152721');
        ctx.fillStyle=earth;ctx.fillRect(0,ground,width,height-ground);
        ctx.strokeStyle='rgba(226,201,133,.22)';ctx.lineWidth=1;
        for(let j=0;j<5;j++){
            ctx.beginPath();ctx.moveTo(0,ground+18+j*24);ctx.bezierCurveTo(width*.28,ground-4+j*28,width*.62,ground+42+j*17,width,ground+12+j*25);ctx.stroke();
        }

        drawVillage();
        const vignette=ctx.createRadialGradient(width*.5,height*.45,height*.15,width*.5,height*.48,width*.72);
        vignette.addColorStop(.55,'rgba(3,9,9,0)');vignette.addColorStop(1,'rgba(3,9,9,.5)');
        ctx.fillStyle=vignette;ctx.fillRect(0,0,width,height);
    }

    function drawMountain(base,color,phase,amp,seed){
        ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(0,height);
        ctx.lineTo(0,base);
        const steps=9;
        for(let i=0;i<=steps;i++){
            const x=width*i/steps;
            const y=base-Math.abs(Math.sin(i*1.73+seed))*amp*(.55+Math.sin(i*.9+phase)*.25);
            ctx.lineTo(x,y);
        }
        ctx.lineTo(width,height);ctx.closePath();ctx.fill();
    }

    function drawVillage(){
        const ground=groundY();
        ctx.save();ctx.globalAlpha=.52;
        for(let i=0;i<5;i++){
            const x=width*(.31+i*.09), y=ground-18-(i%2)*7, w=34+(i%3)*7;
            ctx.fillStyle='#d7c38d';ctx.fillRect(x,y,w,18);
            ctx.fillStyle='#3d3430';ctx.beginPath();ctx.moveTo(x-7,y);ctx.lineTo(x+w/2,y-17);ctx.lineTo(x+w+7,y);ctx.closePath();ctx.fill();
            ctx.fillStyle='#8e3c35';ctx.fillRect(x+w*.42,y+6,7,12);
        }
        ctx.restore();
    }

    function drawHoop(){
        const poleX=hoop.x+hoop.rx+10;
        const ground=groundY();
        ctx.save();
        ctx.strokeStyle='rgba(17,26,27,.34)';ctx.lineWidth=9;ctx.lineCap='round';
        ctx.beginPath();ctx.moveTo(poleX+4,hoop.y);ctx.lineTo(poleX+4,ground+5);ctx.stroke();
        const metal=ctx.createLinearGradient(poleX-5,0,poleX+9,0);
        metal.addColorStop(0,'#27383a');metal.addColorStop(.45,'#d7ccad');metal.addColorStop(.62,'#667476');metal.addColorStop(1,'#1a292b');
        ctx.strokeStyle=metal;ctx.lineWidth=6;ctx.beginPath();ctx.moveTo(poleX,hoop.y);ctx.lineTo(poleX,ground+4);ctx.stroke();
        ctx.fillStyle='#242f2d';ctx.beginPath();ctx.ellipse(poleX,ground+5,26,7,0,0,Math.PI*2);ctx.fill();

        ctx.strokeStyle='rgba(8,18,20,.5)';ctx.lineWidth=12;ctx.beginPath();ctx.ellipse(hoop.x+2,hoop.y+3,hoop.rx,hoop.ry,0,0,Math.PI*2);ctx.stroke();
        ctx.strokeStyle=metal;ctx.lineWidth=7;ctx.beginPath();ctx.ellipse(hoop.x,hoop.y,hoop.rx,hoop.ry,0,0,Math.PI*2);ctx.stroke();
        ctx.strokeStyle='#e4bf69';ctx.lineWidth=1.2;ctx.globalAlpha=.72;ctx.beginPath();ctx.ellipse(hoop.x-2,hoop.y-2,hoop.rx-2,hoop.ry-2,0,Math.PI*1.08,Math.PI*1.75);ctx.stroke();

        ctx.globalAlpha=.75;ctx.fillStyle='#f0ddaa';ctx.textAlign='center';ctx.font='11px "Microsoft YaHei"';
        ctx.fillText('穿  环',hoop.x,hoop.y-hoop.ry-16);
        ctx.restore();
    }

    function drawTrajectory(){
        if(state!=='charging') return;
        const radians=angle*Math.PI/180;
        const baseSpeed=Math.max(420,Math.min(900,width*.62));
        const speed=baseSpeed*(.7+Math.max(.12,charge)*.48);
        const start=heldBallPosition();
        ctx.save();ctx.fillStyle='#ef334d';ctx.shadowColor='rgba(225,28,59,.62)';ctx.shadowBlur=7;
        for(let i=1;i<22;i++){
            const t=i*.075;
            const x=start.x+Math.cos(radians)*speed*t;
            const y=start.y-Math.sin(radians)*speed*t+.5*900*t*t;
            if(x>width||y>groundY()) break;
            ctx.globalAlpha=Math.max(.16,.92-i*.032);ctx.beginPath();ctx.arc(x,y,Math.max(1.5,3.4-i*.075),0,Math.PI*2);ctx.fill();
        }
        ctx.restore();
    }

    function drawCharacter(){
        const x=playerX(), ground=groundY();
        const scale=clamp(height/760,.75,1.05);
        const headY=ground-137*scale, shoulderY=ground-105*scale, hipY=ground-59*scale;
        const hand=handPoint();
        ctx.save();ctx.lineCap='round';ctx.lineJoin='round';

        ctx.fillStyle='rgba(6,16,14,.28)';ctx.beginPath();ctx.ellipse(x,ground+5,45*scale,9*scale,0,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle='#171c1b';ctx.lineWidth=8*scale;
        ctx.beginPath();ctx.moveTo(x-8*scale,hipY);ctx.lineTo(x-20*scale,ground-4);ctx.moveTo(x+7*scale,hipY);ctx.lineTo(x+20*scale,ground-4);ctx.stroke();
        ctx.strokeStyle='#ece2ca';ctx.lineWidth=3*scale;
        ctx.beginPath();ctx.moveTo(x-26*scale,ground-3);ctx.lineTo(x-13*scale,ground-3);ctx.moveTo(x+14*scale,ground-3);ctx.lineTo(x+28*scale,ground-3);ctx.stroke();

        ctx.fillStyle='#182626';roundedRect(x-22*scale,shoulderY-5*scale,44*scale,54*scale,8*scale);ctx.fill();
        ctx.strokeStyle='#d9b65e';ctx.lineWidth=2*scale;ctx.beginPath();ctx.moveTo(x,shoulderY);ctx.lineTo(x,hipY-2);ctx.stroke();
        ctx.fillStyle='#a52d42';ctx.fillRect(x-21*scale,hipY-10*scale,42*scale,7*scale);

        ctx.strokeStyle='#202725';ctx.lineWidth=7*scale;
        ctx.beginPath();ctx.moveTo(x-17*scale,shoulderY+5*scale);ctx.lineTo(x-35*scale,hipY-2*scale);ctx.stroke();
        ctx.beginPath();ctx.moveTo(x+17*scale,shoulderY+5*scale);ctx.quadraticCurveTo(x+35*scale,shoulderY-7*scale,hand.x,hand.y);ctx.stroke();
        ctx.fillStyle='#b7835f';ctx.beginPath();ctx.arc(hand.x,hand.y,5*scale,0,Math.PI*2);ctx.fill();

        ctx.fillStyle='#b7835f';ctx.beginPath();ctx.arc(x,headY,16*scale,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='#182121';ctx.beginPath();ctx.arc(x,headY-3*scale,17*scale,Math.PI,Math.PI*2);ctx.lineTo(x+14*scale,headY-8*scale);ctx.quadraticCurveTo(x,headY-24*scale,x-17*scale,headY-5*scale);ctx.fill();
        ctx.strokeStyle='#e2bd64';ctx.lineWidth=4*scale;ctx.beginPath();ctx.moveTo(x-16*scale,headY-12*scale);ctx.quadraticCurveTo(x,headY-20*scale,x+17*scale,headY-10*scale);ctx.stroke();
        ctx.fillStyle='#2b201c';ctx.beginPath();ctx.arc(x+6*scale,headY,1.6*scale,0,Math.PI*2);ctx.fill();
        ctx.restore();
    }

    function drawBallFallback(){
        const r = ball.r;
        ctx.save();ctx.translate(ball.x,ball.y);

        ctx.save();ctx.rotate(ball.spin);
        ctx.shadowColor='rgba(35,10,12,.48)';ctx.shadowBlur=14;ctx.shadowOffsetY=7;
        ctx.fillStyle='#d9ae55';ctx.beginPath();ctx.arc(0,0,r+1.4,0,Math.PI*2);ctx.fill();
        ctx.shadowColor='transparent';

        const petals=['#8ed6d7','#f1c4d7','#f4d573','#ff7652','#84cdbc','#f0bbcd','#f4db78','#ef6b57','#75c4c3','#efbfd4','#f0cf65','#ff825b'];
        for(let i=0;i<12;i++){
            ctx.save();ctx.rotate(i*Math.PI/6);
            const shade=ctx.createLinearGradient(0,0,0,-r);
            shade.addColorStop(0,petals[i]);shade.addColorStop(1,i%2?'#fff1dc':'#d9f4e8');
            ctx.fillStyle=shade;ctx.strokeStyle='#b98a2d';ctx.lineWidth=1.15;
            ctx.beginPath();ctx.moveTo(0,0);
            ctx.bezierCurveTo(-r*.16,-r*.18,-r*.3,-r*.58,0,-r);
            ctx.bezierCurveTo(r*.3,-r*.58,r*.16,-r*.18,0,0);
            ctx.closePath();ctx.fill();ctx.stroke();

            if(i%2===0){
                ctx.globalAlpha=.8;ctx.strokeStyle=i%4===0?'#cf315c':'#f8f0cf';ctx.lineWidth=.72;
                ctx.beginPath();ctx.moveTo(0,-r*.34);ctx.quadraticCurveTo(r*.11,-r*.5,0,-r*.69);
                ctx.moveTo(0,-r*.49);ctx.lineTo(-r*.11,-r*.57);ctx.moveTo(0,-r*.56);ctx.lineTo(r*.1,-r*.64);ctx.stroke();
                ctx.fillStyle='#d94367';ctx.beginPath();ctx.arc(0,-r*.72,1.3,0,Math.PI*2);ctx.fill();
            }
            ctx.restore();
        }

        const sheen=ctx.createRadialGradient(-r*.35,-r*.42,1,0,0,r*1.08);
        sheen.addColorStop(0,'rgba(255,255,255,.64)');sheen.addColorStop(.38,'rgba(255,255,255,.08)');sheen.addColorStop(1,'rgba(61,29,25,.28)');
        ctx.fillStyle=sheen;ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle='#f4d77f';ctx.lineWidth=1.6;ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.stroke();
        ctx.fillStyle='#fff7df';ctx.beginPath();ctx.arc(0,0,4.8,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='#c28b2f';ctx.beginPath();ctx.arc(0,0,3.2,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='#fff4cf';ctx.beginPath();ctx.arc(-1.1,-1.2,1,0,Math.PI*2);ctx.fill();
        ctx.restore();

        ctx.strokeStyle='#c02356';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-r*.28,-r*.92);ctx.quadraticCurveTo(-r*.2,-r-10,0,-r-11);ctx.quadraticCurveTo(r*.2,-r-10,r*.28,-r*.92);ctx.stroke();
        ctx.fillStyle='#f4dc99';ctx.beginPath();ctx.arc(0,-r-7,2.2,0,Math.PI*2);ctx.fill();

        ctx.strokeStyle='#c02356';ctx.lineWidth=1.8;ctx.beginPath();ctx.moveTo(-3,r-1);ctx.quadraticCurveTo(-5,r+9,0,r+13);ctx.quadraticCurveTo(5,r+9,3,r-1);ctx.stroke();
        ctx.fillStyle='#f2d384';ctx.beginPath();ctx.arc(0,r+14,3,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='#3caaa8';ctx.beginPath();ctx.moveTo(0,r+17);ctx.lineTo(4,r+22);ctx.lineTo(0,r+27);ctx.lineTo(-4,r+22);ctx.closePath();ctx.fill();
        const tasselColors=['#c51f58','#e3b64f','#39a8aa','#d52965','#f0d17b'];
        tasselColors.forEach((color,index)=>{
            const offset=(index-2)*2.2;
            ctx.strokeStyle=color;ctx.lineWidth=1.25;ctx.beginPath();ctx.moveTo(0,r+27);ctx.quadraticCurveTo(offset*.35,r+35,offset,r+44+(index%2)*3);ctx.stroke();
        });
        ctx.restore();
    }

    function drawBall(){
        if (!ballSprite.complete || !ballSprite.naturalWidth) {
            drawBallFallback();
            return;
        }
        const drawWidth = ball.r * 3.9;
        const drawHeight = drawWidth * ballSprite.naturalHeight / ballSprite.naturalWidth;
        const coreCenterY = drawHeight * .414;
        const flightTilt = state === 'flying' ? clamp(ball.vy / 1500, -.16, .2) : 0;
        ctx.save();
        ctx.translate(ball.x,ball.y);
        ctx.rotate(flightTilt);
        ctx.shadowColor = 'rgba(25,10,13,.48)';
        ctx.shadowBlur = Math.max(8,ball.r*.55);
        ctx.shadowOffsetY = Math.max(4,ball.r*.22);
        ctx.drawImage(ballSprite,-drawWidth*.5,-coreCenterY,drawWidth,drawHeight);
        ctx.restore();
    }

    function drawString(){
        if(state==='flying'||state==='scored'||state==='missed') return;
        const hand=handPoint();
        const spriteTop = ballSprite.complete && ballSprite.naturalWidth ? ball.y-ball.r*1.88 : ball.y-ball.r+2;
        ctx.save();ctx.strokeStyle='#b8214e';ctx.lineWidth=2.4;ctx.beginPath();ctx.moveTo(hand.x,hand.y);ctx.quadraticCurveTo((hand.x+ball.x)*.5-5,(hand.y+spriteTop)*.5,ball.x,spriteTop);ctx.stroke();ctx.restore();
    }

    function drawParticles(){
        ctx.save();
        particles.forEach(p=>{ctx.globalAlpha=clamp(p.life,0,1);ctx.fillStyle=p.color;ctx.translate(p.x,p.y);ctx.rotate(p.rot);ctx.fillRect(-p.size,-p.size*.45,p.size*2,p.size*.9);ctx.rotate(-p.rot);ctx.translate(-p.x,-p.y);});
        ctx.restore();
    }

    function draw(now){
        ctx.setTransform(dpr,0,0,dpr,0,0);
        ctx.clearRect(0,0,width,height);
        drawBackground(now);
        drawTrajectory();
        drawHoop();
        drawCharacter();
        drawString();
        drawBall();
        drawParticles();
        if(scoreFlash>0){ctx.fillStyle=`rgba(255,224,151,${scoreFlash*.16})`;ctx.fillRect(0,0,width,height);}
    }

    function loop(now){
        if(!open) return;
        const dt=Math.min(.033,Math.max(.001,(now-lastTime)/1000));
        lastTime=now;
        update(dt,now);
        draw(now);
        raf=requestAnimationFrame(loop);
    }

    openButton.addEventListener('click',openGame);
    closeButton.addEventListener('click',closeGame);
    resetButton.addEventListener('click',resetGame);
    soundButton.addEventListener('click',()=>{
        audioEnabled = !audioEnabled;
        localStorage.setItem('xiuqiu-game-sound', audioEnabled ? 'on' : 'off');
        updateSoundButton();
        if (audioEnabled) playTone(659.25,.18,0,.07,'sine');
        else stopChargeTone();
    });
    canvas.addEventListener('pointerdown',event=>{
        event.preventDefault();canvas.setPointerCapture(event.pointerId);startCharge(event.clientY,event.pointerId);
    });
    canvas.addEventListener('pointermove',event=>{ if(event.pointerId===pointerId) adjustAim(event.clientY); });
    canvas.addEventListener('pointerup',event=>endCharge(event.pointerId));
    canvas.addEventListener('pointercancel',event=>endCharge(event.pointerId));
    window.addEventListener('resize',()=>{if(open) resize();});
    window.addEventListener('keydown',event=>{
        if(!open) return;
        if(event.key==='Escape'){closeGame();return;}
        if(event.key==='ArrowUp'||event.key==='ArrowDown'){
            event.preventDefault();angle=clamp(angle+(event.key==='ArrowUp'?2:-2),24,68);angleEl.textContent=Math.round(angle)+'°';
        }
        if(event.code==='Space'&&!event.repeat){event.preventDefault();startCharge(height*.5,'keyboard');}
    });
    window.addEventListener('keyup',event=>{if(open&&event.code==='Space'){event.preventDefault();endCharge('keyboard');}});
    if (new URLSearchParams(location.search).get('game') === '1') {
        window.addEventListener('load', () => setTimeout(openGame, 120), {once:true});
    }
})();
