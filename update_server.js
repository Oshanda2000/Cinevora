import fs from 'fs';

let code = fs.readFileSync('server.js', 'utf8');

const newFunc = `// CHANGED: Replaced google-translate-api-x with Claude API for accurate VTT sync
async function translateVttToSinhala(vttContent) {
    const blocks = vttContent.replace(/\\r/g, '').split(/\\n\\n+/);
    const translatedBlocks = [];
    const BATCH = 60; // strictly 60 per instructions

    translatedBlocks.push(blocks[0]); // keep WEBVTT header

    const anthropicKey = process.env.ANTHROPIC_KEY;
    if (!anthropicKey) {
        console.warn('[TRANSLATE] No ANTHROPIC_KEY found. Reverting to English.');
        return vttContent;
    }

    console.log(\`[TRANSLATE] Using Claude API for \${blocks.length - 1} subtitle chunks\`);

    for (let i = 1; i < blocks.length; i += BATCH) {
        const batchBlocks = blocks.slice(i, i + BATCH);
        const batchToTranslate = [];
        
        // 1. Extract ONLY dialogue text
        batchBlocks.forEach((block, idx) => {
            const lines = block.split('\\n');
            const tcIdx = lines.findIndex(l => l.includes('-->'));
            if (tcIdx >= 0 && tcIdx < lines.length - 1) {
                let rawText = lines.slice(tcIdx + 1).join('\\n').trim();
                if (rawText) {
                    batchToTranslate.push({ index: idx, text: rawText });
                }
            }
        });

        // 2. Call Claude API if we have text
        if (batchToTranslate.length > 0) {
            try {
                // Construct the JSON precisely as requested
                const apiBody = JSON.stringify({
                    model: 'claude-haiku-4-5', // CHANGED: exact model from prompt
                    max_tokens: 4096,
                    messages: [{
                        role: 'user',
                        content: \`You are a professional subtitle translator. Translate the following \${batchToTranslate.length} English movie subtitle lines to Sinhala (සිංහල). Rules:
- Return ONLY a valid JSON array of strings, same count and order as input
- Keep names, places, and sound effects like [MUSIC] or (laughing) unchanged
- Natural conversational Sinhala, not formal/literal translation
- No explanations, no markdown, just the JSON array

Input: \${JSON.stringify(batchToTranslate.map(b => b.text))}\`
                    }]
                });

                const response = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                        'x-api-key': anthropicKey,
                        'anthropic-version': '2023-06-01',
                        'content-type': 'application/json'
                    },
                    body: apiBody
                });
                
                if (!response.ok) {
                    throw new Error(\`Anthropic HTTP error: \${response.status}\`);
                }

                const data = await response.json();
                
                // Handle markdown backticks if Claude decides to wrap the JSON
                let resultText = data.content[0].text.trim();
                if (resultText.startsWith('\`\`\`')) {
                    resultText = resultText.replace(/^\`\`\`[a-z]*\\n?/, '').replace(/\\n?\`\`\`$/, '');
                }

                const translatedArr = JSON.parse(resultText);

                // 3. Validate before accepting
                if (!Array.isArray(translatedArr) || translatedArr.length !== batchToTranslate.length) {
                    console.warn(\`[TRANSLATE] JSON length mismatch. Expected \${batchToTranslate.length}, got \${translatedArr?.length}. Using English fallback for this batch.\`);
                    throw new Error('Length mismatch');
                }

                // Append translated text back into our batch blocks tracking array
                batchToTranslate.forEach((item, idx) => {
                    item.translated = translatedArr[idx];
                });

            } catch (err) {
                console.error(\`[TRANSLATE] Claude batch \${i} failed. Fallback to English. Error: \${err.message}\`);
                // Fallback: keep original text by mapping \`text\` to \`translated\`
                batchToTranslate.forEach(item => {
                    item.translated = item.text;
                });
            }
        }

        // 4. Reassemble blocks
        batchBlocks.forEach((block, idx) => {
            const lines = block.split('\\n');
            const tcIdx = lines.findIndex(l => l.includes('-->'));
            
            const transObj = batchToTranslate.find(b => b.index === idx);
            if (tcIdx >= 0 && transObj && transObj.translated) {
                // Replace everything below matching TC with translated text
                lines.splice(tcIdx + 1, lines.length - (tcIdx + 1), transObj.translated);
                translatedBlocks.push(lines.join('\\n'));
            } else {
                translatedBlocks.push(block); // KEEP original if no translation
            }
        });
    }

    return translatedBlocks.join('\\n\\n');
}`;

// regex to replace old translateVttToSinhala
// find start (async function translateVttToSinhala) and find end (return translatedBlocks.join('\n\n');... })
const startRegex = /async function translateVttToSinhala\s*\([^)]*\)\s*\{/;
const startIndex = code.search(startRegex);

if (startIndex === -1) {
    console.error("COULD NOT FIND translateVttToSinhala");
    process.exit(1);
}

// Find matching closing brace
let braceCount = 0;
let endIndex = -1;
let started = false;

for (let i = startIndex; i < code.length; i++) {
    if (code[i] === '{') {
        started = true;
        braceCount++;
    } else if (code[i] === '}') {
        braceCount--;
        if (started && braceCount === 0) {
            endIndex = i;
            break;
        }
    }
}

if (endIndex !== -1) {
    const originalFunc = code.substring(startIndex, endIndex + 1);
    code = code.replace(originalFunc, newFunc);
    fs.writeFileSync('server.js', code, 'utf8');
    console.log("SUCCESSFULLY REPLACED IN SERVER.JS");
} else {
    console.error("COULD NOT FIND MATCHING END FOR function");
    process.exit(1);
}
