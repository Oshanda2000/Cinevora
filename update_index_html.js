import fs from 'fs';

let html = fs.readFileSync('index.html', 'utf8');

// 1. Add 🎯 Sync Wizard button and ↺ Reset button logic update in HTML
html = html.replace(
    '<button class="si-ctrl-btn yellow" id="si-sync-btn" onclick="toggleSubTimer()">▶ Start Subs</button>',
    '<button class="si-ctrl-btn yellow" id="si-sync-btn" onclick="toggleSubTimer()">▶ Start Subs</button>\n                <button class="si-ctrl-btn" style="color:var(--gold); border-color:var(--gold);" onclick="startSyncWizard()">🎯 Sync Wizard</button>'
);

// We should also look for reset button (it is already there, let's update its title and id maybe, or just we patch JS `resetSubTimer()`)
// For "Reset Sync button in the controls bar", the prompt said "Add a Reset Sync button". We could actually add it explicitly:
html = html.replace(
    '<button class="si-ctrl-btn"        onclick="resetSubTimer()" title="Reset to 0:00:00">↺ Reset</button>',
    '<button class="si-ctrl-btn" onclick="resetSubTimer()" title="Reset to 0:00:00">↺ Reset</button>\n                <button class="si-ctrl-btn" onclick="resetSyncData()" title="Clear saved sync offset">↺ Reset Sync</button>'
);

// 2. Inject Sync Wizard HTML overlay into the modal
const wizardHTML = `
            <!-- CHANGED: Sync Wizard Overlay -->
            <div id="si-sync-wizard" style="display:none; position:absolute; bottom:80px; left:50%; transform:translateX(-50%); background:rgba(20,20,20,0.95); border:1px solid var(--border-light); border-radius:12px; padding:20px; text-align:center; z-index:100; min-width:300px; box-shadow:0px 10px 30px rgba(0,0,0,0.8);">
                <h4 style="margin:0 0 10px 0; color:var(--gold);">🎯 Sync Wizard</h4>
                <div id="si-wizard-content"></div>
                <div style="margin-top:15px; display:flex; gap:10px; justify-content:center;">
                    <button id="si-wizard-tap-btn" class="si-ctrl-btn yellow" style="padding:10px 20px; font-size:1.1rem; border-radius:8px;">TAP when you HEAR it!</button>
                    <button id="si-wizard-skip-btn" class="si-ctrl-btn" style="padding:10px 15px;">Skip ⏭</button>
                    <button class="si-ctrl-btn" style="border:none;" onclick="closeSyncWizard()">Cancel</button>
                </div>
            </div>
`;

html = html.replace(
    '<!-- Row 2: Smart Sync Controls -->',
    wizardHTML + '\n            <!-- Row 2: Smart Sync Controls -->'
);

// 3. Inject JS logic
const wizardJS = `
        // ── CHANGED: Sync Wizard Handlers ─────────────────────────────────────
        let _wizardState = {
            active: false,
            cues: [],
            currIdx: 0,
            taps: [], // Array of { offsetMs }
            startTime: 0
        };

        function startSyncWizard() {
            if (!window.activeSubs || window.activeSubs.length === 0) {
                alert("Please select a subtitle language first!");
                return;
            }

            // If timer isn't started yet, start it now
            if (!_SI.running) {
                toggleSubTimer();
            }

            _wizardState.active = true;
            _wizardState.currIdx = 0;
            _wizardState.taps = [];
            _wizardState.startTime = Date.now(); // this tracks the "wizard start Time" conceptually, but practically we measure offset based on engine time _siNow().

            // Pick 5 cues across first 20 minutes (first 1200 seconds)
            // spaced at least 2 minutes (120s) apart
            const selectedCues = [];
            let lastCueEnd = 0;
            
            for (let i = 0; i < window.activeSubs.length; i++) {
                const cue = window.activeSubs[i];
                if (cue.start > 1200) break; // past 20 minutes
                if (cue.start >= lastCueEnd + 120) {
                    // It's spaced well enough, is it a decent length string?
                    const txt = cue.text.replace(/<[^>]+>/g, '').trim();
                    if (txt.length > 5 && txt.length < 80) { // avoid giant paragraphs or short grunts
                        selectedCues.push(cue);
                        lastCueEnd = cue.start;
                        if (selectedCues.length === 5) break;
                    }
                }
            }

            if (selectedCues.length < 3) {
                alert("Not enough well-spaced subtitles in the first 20 minutes to run the wizard.");
                _wizardState.active = false;
                return;
            }

            _wizardState.cues = selectedCues;
            
            document.getElementById('si-sync-wizard').style.display = 'block';
            renderWizardCue();
        }

        function closeSyncWizard() {
            document.getElementById('si-sync-wizard').style.display = 'none';
            _wizardState.active = false;
        }

        function renderWizardCue() {
            if (_wizardState.currIdx >= _wizardState.cues.length) {
                finishWizard();
                return;
            }
            const cue = _wizardState.cues[_wizardState.currIdx];
            const cleanText = cue.text.replace(/<[^>]+>/g, '');
            
            document.getElementById('si-wizard-content').innerHTML = \`
                <p style="margin:0 0 5px 0; color:var(--muted); font-size:0.9rem;">Listen for this line:</p>
                <div style="font-size:1.2rem; font-weight:bold; color:white; margin-bottom:5px;">"\${cleanText}"</div>
                <div style="font-size:0.8rem; color:var(--muted);">(line \${_wizardState.currIdx + 1} of \${_wizardState.cues.length})</div>
            \`;

            // Reset tap binding
            document.getElementById('si-wizard-tap-btn').onclick = () => handleWizardTap(cue);
            document.getElementById('si-wizard-skip-btn').onclick = () => {
                _wizardState.currIdx++;
                renderWizardCue();
            };
        }

        function handleWizardTap(cue) {
            // Tap! Calculate the offset in seconds.
            // When tap happens, the subtitle SHOULD HAVE BEEN at cue.start.
            // The running engine is currently at _siNow().
            // So we need: _siEffective() == cue.start
            // Since _siEffective() = _siNow() + newOffset
            // newOffset = cue.start - _siNow()
            
            const tapOffsetSeconds = cue.start - _siNow();
            _wizardState.taps.push(tapOffsetSeconds);
            
            // Highlight TAP button briefly
            const btn = document.getElementById('si-wizard-tap-btn');
            const origColor = btn.style.background;
            btn.style.background = '#0f0';
            btn.style.color = '#000';
            setTimeout(() => {
                btn.style.background = origColor;
                btn.style.color = '';
                
                _wizardState.currIdx++;
                finishWizardCheck();
            }, 300);
        }

        function finishWizardCheck() {
            if (_wizardState.taps.length >= 3) {
                finishWizard();
            } else {
                renderWizardCue();
            }
        }

        function finishWizard() {
            closeSyncWizard();
            
            if (_wizardState.taps.length < 2) {
                alert("Not enough data - try again. (Need at least 2 taps)");
                return;
            }
            
            // Sort to find median
            _wizardState.taps.sort((a, b) => a - b);
            const mid = Math.floor(_wizardState.taps.length / 2);
            let medianOffset = _wizardState.taps.length % 2 !== 0 
                ? _wizardState.taps[mid] 
                : (_wizardState.taps[mid - 1] + _wizardState.taps[mid]) / 2.0;
            
            // Apply it! Keep previous offset in mind? 
            // The tap effectively overrides everything because it compares cue.start with raw engine _siNow().
            // Oh wait, _siNow() is purely Date.now() based. 
            // _SI.offset is the *correction*.
            // We fully override the old _SI.offset with this new medianOffset.
            _SI.offset = medianOffset;
            
            // Flash success
            document.getElementById('si-offset-val').textContent = _SI.offset > 0 ? \`+\${_SI.offset.toFixed(1)}s\` : \`\${_SI.offset.toFixed(1)}s\`;
            
            // Save it
            localStorage.setItem(\`cinevora_sync_\${_SI.movieId}\`, _SI.offset.toFixed(2));
            
            // Replace Sub Status chip temporarily to show success
            const status = document.getElementById('si-sub-status');
            if (status) {
                const orig = status.textContent;
                status.textContent = \`✅ Synced! Offset: \${_SI.offset > 0 ? '+' : ''}\${_SI.offset.toFixed(1)}s applied\`;
                status.style.background = 'rgba(0, 255, 0, 0.2)';
                status.style.color = '#0f0';
                setTimeout(() => {
                    status.textContent = orig;
                    status.style.background = '';
                    status.style.color = '';
                    setSubStatus(orig, 'ready');
                }, 3000);
            }
        }

        function resetSyncData() { // CHANGED
            if (!_SI.movieId) return; // CHANGED
            localStorage.removeItem(\`cinevora_sync_\${_SI.movieId}\`); // CHANGED
            localStorage.removeItem(\`cinevora_offset_\${_SI.movieId}\`); // back compat // CHANGED
            _SI.offset = 0; // CHANGED
            document.getElementById('si-offset-val').textContent = '0s'; // CHANGED
            const status = document.getElementById('si-sub-status'); // CHANGED
            if (status) { // CHANGED
                status.textContent = '↺ Sync Reset'; // CHANGED
                setTimeout(() => setSubStatus('Ready', 'ready'), 2000); // CHANGED
            } // CHANGED
        } // CHANGED
        // ──────────────────────────────────────────────────────────────────────
`;

html = html.replace('function _siSaveOffset()', wizardJS + '\n        function _siSaveOffset()')

// Update localStorage keys in load/save functions
html = html.replace(/cinevora_offset_/g, 'cinevora_sync_');

fs.writeFileSync('index.html', html, 'utf8');
console.log("SUCCESSFULLY UPDATED INDEX.HTML");
