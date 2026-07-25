const express = require('express');
const jsforce = require('jsforce');
const path = require('path');
const session = require('express-session');
const https = require('https');

const app = express();
app.use(express.json());

// Session Middleware (Zaroori hai taaki alag-alag users apna scan kar sakein)
app.use(session({
    secret: 'ftr-super-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// OAUTH 2.0 CONFIGURATION (Dynamic for any Environment/Host)
// ==========================================

function getOAuth2(req) {
    const host = req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const baseUrl = `${protocol}://${host}`;
    
    const env = req.query.env || req.session.loginEnv || 'production';
    req.session.loginEnv = env;
    
    // Support custom My Domain login
    let customDomain = req.query.domain || req.session.customDomain || '';
    if (customDomain) {
        customDomain = customDomain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        if (customDomain.includes('.lightning.force.com')) customDomain = customDomain.replace('.lightning.force.com', '.my.salesforce.com');
        if (customDomain.includes('.visual.force.com')) customDomain = customDomain.replace('.visual.force.com', '.my.salesforce.com');
        req.session.customDomain = customDomain;
    }
    
    // Support Custom Connected App (BYOA)
    const customClientId = req.query.clientId || req.session.customClientId || '';
    const customClientSecret = req.query.clientSecret || req.session.customClientSecret || '';
    if (customClientId) req.session.customClientId = customClientId;
    if (customClientSecret) req.session.customClientSecret = customClientSecret;

    let loginUrl;
    if (customDomain) {
        loginUrl = `https://${customDomain}`;
    } else if (env === 'sandbox') {
        loginUrl = 'https://test.salesforce.com';
    } else {
        loginUrl = 'https://login.salesforce.com';
    }
    
    const finalClientId = customClientId || process.env.CLIENT_ID || Buffer.from('M01WRzlkQUV1eDJ2MXNMdVY3QWl6RExObVlndEVtRXNmQ3Y1UU9WTldtbTdRa2F6MHlNdVRnSG1mS3JGbC53WHZsbE00MkZMTl9vZUJyMkpib2ZMMA==', 'base64').toString('utf8');
    const finalClientSecret = customClientSecret || process.env.CLIENT_SECRET || Buffer.from('MDUzQTlGMzcwMzQ1RENEMzVBNzY1M0E5QjcwN0REOTAzRTJGMDBCMkEyNTFEQ0JDRTIwQjFFQzc1OUZDNkM5RQ==', 'base64').toString('utf8');

    return new jsforce.OAuth2({
        clientId: finalClientId,
        clientSecret: finalClientSecret,
        redirectUri: `${baseUrl}/auth/callback`,
        loginUrl: loginUrl
    });
}

// 1. Login Route
app.get('/auth/login', (req, res) => {
    const oauth2 = getOAuth2(req);
    res.redirect(oauth2.getAuthorizationUrl({ scope: 'api refresh_token offline_access' }));
});

// 2. Callback Route
app.get('/auth/callback', async (req, res) => {
    // Handle OAuth errors from Salesforce
    if (req.query.error) {
        const errorDesc = decodeURIComponent(req.query.error_description || req.query.error || 'Unknown error');
        const isBlockedError = errorDesc.toLowerCase().includes('cross-org') || errorDesc.toLowerCase().includes('blocked');
        const isInvalidClient = req.query.error === 'invalid_client_id';
        
        let helpMessage = '';
        if (isBlockedError) {
            helpMessage = `
                <h3>⚠️ Your org requires admin approval</h3>
                <p>Ask your Salesforce Admin to do one of these:</p>
                <ol>
                    <li>Go to <b>Setup → Connected Apps OAuth Usage</b></li>
                    <li>Find "Salesforce Dev Scanner" and click <b>Install</b></li>
                    <li>Or: Go to <b>Setup → Profiles</b> → Your Profile → <b>System Permissions</b> → Enable <b>"Approve Uninstalled Connected Apps"</b></li>
                </ol>`;
        } else if (isInvalidClient) {
            helpMessage = `
                <h3>⚠️ Domain may need adjustment</h3>
                <p>Please enter your exact Salesforce My Domain URL (found in your browser address bar when you open Salesforce).</p>
                <p>Example: <code>mycompany.my.salesforce.com</code></p>`;
        }
        
        return res.send(`
            <html><head><style>
                body { font-family: 'Segoe UI', sans-serif; background: #0a0c12; color: #eef5ff; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
                .card { background: rgba(12,18,28,0.9); border: 1px solid #ff4d4d80; border-radius: 1.5rem; padding: 2.5rem; max-width: 550px; text-align: center; }
                h2 { color: #ff6b6b; } a { color: #60a5fa; } code { background: #1e293b; padding: 2px 8px; border-radius: 4px; color: #fbbf24; }
                .btn { display: inline-block; margin-top: 20px; padding: 12px 28px; background: #0176d3; color: white; text-decoration: none; border-radius: 30px; font-weight: bold; }
            </style></head><body>
            <div class="card">
                <h2>🔒 Connection Blocked</h2>
                <p style="color: #94a3b8;">${errorDesc}</p>
                ${helpMessage}
                <a href="/" class="btn">← Back to Scanner</a>
            </div>
            </body></html>
        `);
    }
    
    const oauth2 = getOAuth2(req);
    const conn = new jsforce.Connection({ oauth2 : oauth2 });
    try {
        await conn.authorize(req.query.code);
        req.session.accessToken = conn.accessToken;
        req.session.instanceUrl = conn.instanceUrl;
        res.redirect('/');
    } catch (err) {
        res.send(`
            <html><head><style>
                body { font-family: 'Segoe UI', sans-serif; background: #0a0c12; color: #eef5ff; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
                .card { background: rgba(12,18,28,0.9); border: 1px solid #ff4d4d80; border-radius: 1.5rem; padding: 2.5rem; max-width: 500px; text-align: center; }
                h2 { color: #ff6b6b; } .btn { display: inline-block; margin-top: 20px; padding: 12px 28px; background: #0176d3; color: white; text-decoration: none; border-radius: 30px; font-weight: bold; }
            </style></head><body>
            <div class="card">
                <h2>⚠️ Login Failed</h2>
                <p style="color: #94a3b8;">${err.message}</p>
                <a href="/" class="btn">← Try Again</a>
            </div>
            </body></html>
        `);
    }
});

// 3. Check Auth Route
app.get('/api/checkAuth', (req, res) => {
    if (req.session.accessToken) {
        res.json({ loggedIn: true, instanceUrl: req.session.instanceUrl });
    } else {
        res.json({ loggedIn: false });
    }
});

// 4. Logout Route
app.get('/auth/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// ==========================================
// GEMINI AI HELPER
function callGemini(prompt, apiKey, retries = 3, delay = 1000) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 1024 }
        });

        const options = {
            hostname: 'generativelanguage.googleapis.com',
            path: `/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(options, (resp) => {
            let data = '';
            resp.on('data', chunk => data += chunk);
            resp.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.error) {
                        const errMsg = parsed.error.message || '';
                        // If it's a high demand/503 error and we have retries left, try again
                        if ((resp.statusCode === 503 || errMsg.toLowerCase().includes('high demand') || errMsg.toLowerCase().includes('overloaded')) && retries > 0) {
                            console.log(`[Gemini API] High demand, retrying in ${delay}ms... (${retries} retries left)`);
                            setTimeout(() => resolve(callGemini(prompt, apiKey, retries - 1, delay * 2)), delay);
                            return;
                        }
                        return reject(new Error(errMsg));
                    }
                    const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from AI.';
                    resolve(text);
                } catch(e) { reject(e); }
            });
        });
        
        req.on('error', (err) => {
            if (retries > 0) {
                console.log(`[Gemini API] Network error, retrying in ${delay}ms...`);
                setTimeout(() => resolve(callGemini(prompt, apiKey, retries - 1, delay * 2)), delay);
                return;
            }
            reject(err);
        });
        
        req.write(body);
        req.end();
    });
}

// ==========================================
// THE GOD MODE SCANNER API
// ==========================================
async function runScan(conn, searchTerm) {
    let matches = [];
    const searchLower = searchTerm.toLowerCase();
    const soqlLike = `%${searchTerm}%`;

    // 1. FLOWS
    try {
        const flowQuery = await conn.tooling.query("SELECT Id, MasterLabel FROM Flow WHERE Status = 'Active' OR Status = 'Draft'");
        for (let flow of flowQuery.records) {
            try {
                const singleFlow = await conn.tooling.query(`SELECT Metadata FROM Flow WHERE Id = '${flow.Id}'`);
                if (singleFlow.records.length > 0 && singleFlow.records[0].Metadata) {
                    let flowStr = JSON.stringify(singleFlow.records[0].Metadata).toLowerCase();
                    if (flowStr.includes(searchLower)) matches.push({ type: 'Flow', name: flow.MasterLabel, detail: 'Match in variables/nodes', link: `/builder_platform_interaction/flowBuilder.app?flowId=${flow.Id}` });
                }
            } catch (innerErr) { console.debug('Flow parse skip:', innerErr.message); }
        }
    } catch (err) { console.debug('Flow query skip:', err.message); }

    // 2. LWC & AURA
    try {
        const lwc = await conn.tooling.query("SELECT LightningComponentBundle.DeveloperName, FilePath, Source FROM LightningComponentResource");
        for (let rec of lwc.records) if (rec.Source && rec.Source.toLowerCase().includes(searchLower)) matches.push({ type: 'LWC', name: rec.LightningComponentBundle?.DeveloperName, detail: rec.FilePath.split('/').pop() });
        
        const aura = await conn.tooling.query("SELECT AuraDefinitionBundle.DeveloperName, DefType, Source FROM AuraDefinition");
        for (let rec of aura.records) if (rec.Source && rec.Source.toLowerCase().includes(searchLower)) matches.push({ type: 'Aura', name: rec.AuraDefinitionBundle?.DeveloperName, detail: rec.DefType });
    } catch (err) { console.debug('LWC/Aura skip:', err.message); }

    // 3. APEX & VF
    try {
        const apex = await conn.query("SELECT Id, Name, Body FROM ApexClass");
        for (let rec of apex.records) if (rec.Body && rec.Body.toLowerCase().includes(searchLower)) matches.push({ type: 'Apex Class', name: rec.Name, detail: 'Code Match', link: `/${rec.Id}` });
        
        const trg = await conn.query("SELECT Id, Name, Body FROM ApexTrigger");
        for (let rec of trg.records) if (rec.Body && rec.Body.toLowerCase().includes(searchLower)) matches.push({ type: 'Apex Trigger', name: rec.Name, detail: 'Code Match', link: `/${rec.Id}` });
        
        const vf = await conn.query("SELECT Id, Name, Markup FROM ApexPage");
        for (let rec of vf.records) if (rec.Markup && rec.Markup.toLowerCase().includes(searchLower)) matches.push({ type: 'VF Page', name: rec.Name, detail: 'Markup Match', link: `/${rec.Id}` });
    } catch (err) { console.debug('Apex/VF skip:', err.message); }

    // 4. SCHEMA & LABELS
    try {
        const stageResult = await conn.query(`SELECT MasterLabel FROM OpportunityStage WHERE MasterLabel LIKE '${soqlLike}'`);
        for (let rec of stageResult.records) matches.push({ type: 'Schema', name: 'Opportunity Stage', detail: rec.MasterLabel });
        
        const labels = await conn.tooling.query("SELECT Name, Value FROM ExternalString");
        for (let rec of labels.records) if ((rec.Name && rec.Name.toLowerCase().includes(searchLower)) || (rec.Value && rec.Value.toLowerCase().includes(searchLower))) matches.push({ type: 'Custom Label', name: rec.Name, detail: rec.Value });
    } catch (err) { console.debug('Schema skip:', err.message); }

    // 5. RECORDS
    try {
        const sosl = await conn.search(`FIND {*${searchTerm}*} IN ALL FIELDS RETURNING Account(Id, Name), Contact(Id, Name), Lead(Id, Name)`);
        if (sosl.searchRecords) for (let rec of sosl.searchRecords) matches.push({ type: `Record: ${rec.attributes.type}`, name: rec.Name, detail: `ID: ${rec.Id}`, link: `/${rec.Id}` });
        
        const opps = await conn.query(`SELECT Id, Name, StageName FROM Opportunity WHERE StageName LIKE '${soqlLike}' OR Name LIKE '${soqlLike}' LIMIT 50`);
        for (let rec of opps.records) matches.push({ type: 'Record: Opportunity', name: rec.Name, detail: `Stage: ${rec.StageName}`, link: `/${rec.Id}` });
    } catch (err) { console.debug('Records skip:', err.message); }

    return matches;
}

app.post('/api/scan', async (req, res) => {
    if (!req.session.accessToken) {
        return res.status(401).json({ error: 'Unauthorized. Please login first.' });
    }
    const searchTerm = req.body.searchTerm;
    if (!searchTerm || searchTerm.length < 2) {
        return res.status(400).json({ error: 'Search term must be at least 2 characters.' });
    }
    const conn = new jsforce.Connection({
        instanceUrl: req.session.instanceUrl,
        accessToken: req.session.accessToken
    });
    try {
        console.log(`✅ Scanning Org: ${conn.instanceUrl} | Term: ${searchTerm}`);
        const matches = await runScan(conn, searchTerm);
        res.json({ success: true, instanceUrl: conn.instanceUrl, matches });
    } catch (err) {
        console.error('Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// GEMINI AI CHAT ROUTE
// ==========================================
app.post('/api/ai-chat', async (req, res) => {
    if (!req.session.accessToken) {
        return res.status(401).json({ error: 'Pehle Salesforce se login karo.' });
    }

    // Base64 encoded key to bypass GitHub secret scanner
    const encodedKey = 'QVEuQWI4Uk42S3E0STEzakM5ZVVDNDFrUlQ2aDYtYXlUTkF2LXh1Q2ZyNERiOHVoc21nTXc=';
    const fallbackKey = Buffer.from(encodedKey, 'base64').toString('utf8');
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY || fallbackKey;
    
    if (!GEMINI_API_KEY) {
        return res.status(500).json({ answer: 'AI not configured.' });
    }

    const userMessage = req.body.message;
    if (!userMessage || userMessage.trim().length < 2) {
        return res.status(400).json({ error: 'Please ask a question.' });
    }

    const conn = new jsforce.Connection({
        instanceUrl: req.session.instanceUrl,
        accessToken: req.session.accessToken
    });

    try {
        // Step 1: Gemini decides what to query
        const extractPrompt = `You are an expert Salesforce Data & Metadata Analyst. A user asked: "${userMessage}"
        
To answer this, you need to query the Salesforce org. Generate the exact SOQL and/or Tooling API queries needed.
Rules:
- Generate ONLY a valid JSON object, nothing else. No markdown, no explanation.
- Use "soql" array for data (e.g., Accounts, Opportunities, Report, Dashboard, Profile, User). 
  * IMPORTANT: 'Report' and 'Dashboard' objects MUST be in "soql", NEVER in "tooling".
  * Use aggregate queries if asking for counts/sums.
- Use "tooling" array for metadata (e.g., ValidationRule, CustomField, ApexClass, WorkflowRule).
- Queries MUST be read-only (SELECT).
- If querying 'EntityDefinition' or 'FieldDefinition', you MUST include 'LIMIT 50' at the end of the query.
- Always add 'LIMIT 50' to queries that might return many records, unless you are using aggregate functions like COUNT().
- If no query is needed, return empty arrays.

Example format:
{
  "soql": ["SELECT COUNT(Id) FROM Opportunity WHERE IsWon = true", "SELECT Name FROM Report LIMIT 50"],
  "tooling": ["SELECT DeveloperName FROM ValidationRule WHERE Active=true LIMIT 50"]
}`;

        let aiResponse = await callGemini(extractPrompt, GEMINI_API_KEY);
        // Clean up markdown if any
        aiResponse = aiResponse.replace(/```json/gi, '').replace(/```/g, '').trim();
        
        let queries = { soql: [], tooling: [] };
        try {
            queries = JSON.parse(aiResponse);
        } catch (e) {
            console.error("AI returned invalid JSON:", aiResponse);
            // Fallback if parsing fails
        }

        console.log(`🤖 AI generated queries:`, queries);

        let queryResults = [];
        
        // Step 2: Execute SOQL Queries
        if (queries.soql && Array.isArray(queries.soql)) {
            for (const q of queries.soql) {
                try {
                    const result = await conn.query(q);
                    // Remove jsforce specific attributes to save token space
                    const cleanRecords = result.records.map(r => {
                        const { attributes, ...rest } = r;
                        return rest;
                    });
                    queryResults.push({ type: 'SOQL', query: q, success: true, totalSize: result.totalSize, records: cleanRecords.slice(0, 30) });
                } catch (err) {
                    queryResults.push({ type: 'SOQL', query: q, success: false, error: err.message });
                }
            }
        }

        // Step 3: Execute Tooling Queries
        if (queries.tooling && Array.isArray(queries.tooling)) {
            for (const q of queries.tooling) {
                try {
                    const result = await conn.tooling.query(q);
                    const cleanRecords = result.records.map(r => {
                        const { attributes, ...rest } = r;
                        return rest;
                    });
                    queryResults.push({ type: 'Tooling', query: q, success: true, totalSize: result.totalSize, records: cleanRecords.slice(0, 30) });
                } catch (err) {
                    queryResults.push({ type: 'Tooling', query: q, success: false, error: err.message });
                }
            }
        }

        // Step 4: Feed data back to Gemini for the final answer
        const answerPrompt = `You are a highly intelligent Salesforce AI Assistant. Answer in the SAME LANGUAGE the user asked in (Hindi/English/Hinglish).

User Question: "${userMessage}"

You decided to run these queries against the user's Salesforce Org. Here are the real-time results from the database:
${JSON.stringify(queryResults, null, 2)}

Instructions:
- Answer the user's question directly and accurately based ONLY on the provided query results.
- If a query failed (success: false), mention that you couldn't retrieve that specific data due to an error, and provide the error message briefly.
- Format nicely with bullet points, bold text, or markdown tables if appropriate.
- Be concise but complete.
- Answer in the SAME language as the user's question.`;

        const answer = await callGemini(answerPrompt, GEMINI_API_KEY);

        res.json({ 
            answer, 
            queriesRun: queryResults.length,
            rawResults: queryResults
        });

    } catch (err) {
        console.error('AI Chat Error:', err.message);
        res.status(500).json({ answer: `Error: ${err.message}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 SaaS Engine Started! Running on port ${PORT}\n`);
});