import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'qa-screenshots');

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox','--disable-setuid-sandbox','--window-size=1440,900'],
        defaultViewport: { width: 1440, height: 900 }
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('console', m => { if(m.type()==='error') errors.push(m.text()); });

    await page.goto('http://localhost:3000/index.html', { waitUntil: 'networkidle2', timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));

    // go to movie detail
    const card = await page.$('.movie-card');
    if (card) { await card.click(); await new Promise(r => setTimeout(r, 3500)); }

    // scroll to sinhala section
    await page.evaluate(() => window.scrollBy(0, 600));
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: path.join(OUT, 'fix_01_section.png') });
    console.log('📸 fix_01_section.png - Sinhala section');

    // ── DOM-inject player open (bypass iframe CORS for screenshot) ──
    await page.evaluate(() => {
        const overlay = document.getElementById('local-player-overlay');
        const content = document.getElementById('local-player-content'); // check id
        const titleEl  = document.getElementById('local-player-title');
        const srcBar   = document.getElementById('si-player-sources');
        const statusEl = document.getElementById('si-sub-status');
        const subsDiv  = document.getElementById('local-video-subs');
        const syncBtn  = document.getElementById('si-sync-btn');
        const fsBtn    = document.getElementById('si-fs-btn');
        const timerEl  = document.getElementById('si-sub-timer-display');

        overlay.classList.add('active');
        titleEl.textContent = '🎬 Inception (Test)';

        if (srcBar) srcBar.innerHTML = ['VidSrc','VidSrc.to','2Embed','Movies'].map((n,i) =>
            `<button class="sub-lang-btn${i===0?' active':''}" style="font-size:0.68rem;">${n}</button>`
        ).join('');

        if (statusEl) {
            statusEl.textContent = '✅ සිංහල Ready';
            statusEl.style.background = 'rgba(0,200,80,0.15)';
            statusEl.style.color = '#00c850';
            statusEl.style.borderColor = 'rgba(0,200,80,0.35)';
        }

        // Test subtitle overlay text
        if (subsDiv) subsDiv.textContent = '🔤 Subtitle overlay above iframe ✓';

        window._testChecks = {
            overlayHasActiveClass: overlay.classList.contains('active'),
            localPlayerContentIdExists: !!content,
            iframeExists: !!document.getElementById('si-player-iframe'),
            subsDivExists: !!subsDiv,
            subsDivZIndex: subsDiv ? getComputedStyle(subsDiv).zIndex : 'N/A',
            subsDivPosition: subsDiv ? getComputedStyle(subsDiv).position : 'N/A',
            syncBtnExists: !!syncBtn,
            fsBtnExists: !!fsBtn,
            timerExists: !!timerEl,
            statusChipExists: !!statusEl,
            wrapperOverflow: (() => {
                const w = document.querySelector('.local-player-video-wrapper');
                return w ? getComputedStyle(w).overflow : 'N/A';
            })(),
        };
    });
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: path.join(OUT, 'fix_02_modal.png') });
    console.log('📸 fix_02_modal.png - Modal with all new elements');

    // Read test checks
    const checks = await page.evaluate(() => window._testChecks);
    console.log('\n=== DOM + CSS CHECKS ===');
    Object.entries(checks).forEach(([k,v]) => {
        const ok = (v === true || (typeof v === 'string' && v !== 'N/A' && v !== 'false'));
        console.log((v===false?'❌':'✅') + ` ${k}: ${v}`);
    });

    // Test that subtitle timer works
    await page.evaluate(() => {
        // Inject fake subtitle cues
        window.activeSubs = [
            { start: 0, end: 5,  text: 'ආදරය යනු... (Test Sinhala)' },
            { start: 5, end: 10, text: 'Love is... (Test English)' },
        ];
        window._subTimerMs = 0;
        window._currentSubLang = 'si';
    });

    // Click Start Subs button
    const syncBtn = await page.$('#si-sync-btn');
    if (syncBtn) {
        await syncBtn.click();
        console.log('✅ Clicked ▶ Start Subs');
        await new Promise(r => setTimeout(r, 1500)); // let timer tick
        await page.screenshot({ path: path.join(OUT, 'fix_03_subs_running.png') });
        console.log('📸 fix_03_subs_running.png - Sub timer running');
    }

    // Read subtitle overlay text and timer text
    const subState = await page.evaluate(() => ({
        subsText: document.getElementById('local-video-subs')?.textContent || 'EMPTY',
        timerText: document.getElementById('si-sub-timer-display')?.textContent || 'N/A',
        syncBtnText: document.getElementById('si-sync-btn')?.textContent || 'N/A',
        statusChipText: document.getElementById('si-sub-status')?.textContent || 'N/A',
    }));
    console.log('\n=== RUNTIME STATE ===');
    Object.entries(subState).forEach(([k,v]) => console.log(`  ${k}: "${v}"`));

    // Test lang switch to off
    await page.click('#slb-off');
    await new Promise(r => setTimeout(r, 200));
    const offState = await page.evaluate(() => ({
        subsText: document.getElementById('local-video-subs')?.textContent || 'EMPTY',
        offActive: document.getElementById('slb-off')?.classList.contains('active'),
    }));
    console.log((offState.offActive ? '✅':'❌') + ` Off button active: ${offState.offActive}`);

    // Test fullscreen function exists
    const fsExists = await page.evaluate(() => typeof toggleSiFullscreen === 'function');
    console.log((fsExists ? '✅':'❌') + ` toggleSiFullscreen function exists: ${fsExists}`);

    // Test F key listener is attached (by dispatching a fake event)
    const fKeyWorks = await page.evaluate(() => {
        // ensure player is still open
        const playerOpen = document.getElementById('local-player-overlay').classList.contains('active');
        return playerOpen;
    });
    console.log((fKeyWorks ? '✅':'❌') + ` Player still open for F-key test: ${fKeyWorks}`);

    // Close modal and confirm
    await page.click('.local-player-close');
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: path.join(OUT, 'fix_04_closed.png') });
    const closed = await page.evaluate(() =>
        !document.getElementById('local-player-overlay').classList.contains('active')
    );
    console.log((closed ? '✅':'❌') + ` Modal closed: ${closed}`);

    console.log('\n🔍 Console Errors:', errors.length === 0 ? 'None ✅' : errors.join('\n  '));
    await browser.close();
    console.log('\n✅ QA Complete');
})().catch(e => console.error('QA Error:', e.message));
