const express = require('express');
const jsforce = require('jsforce');
const path = require('path');
const session = require('express-session');

const app = express();
app.use(express.json());

// Session Middleware (Zaroori hai taaki alag-alag users apna scan kar sakein)
app.use(session({
    secret: 'ftr-super-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Localhost ke liye false
}));

app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// OAUTH 2.0 CONFIGURATION (Dynamic for any Environment/Host)
// ==========================================

function getOAuth2(req) {
    const host = req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const baseUrl = `${protocol}://${host}`;
    
    // Check if the user selected a sandbox environment
    const env = req.query.env || req.session.loginEnv || 'production';
    req.session.loginEnv = env;
    
    const loginUrl = env === 'sandbox' ? 'https://test.salesforce.com' : 'https://login.salesforce.com';
    
    return new jsforce.OAuth2({
        clientId: process.env.CLIENT_ID || '3MVG9dAEux2v1sLuV7AizDLNmYgtEmEsfCv5QOVNWmm7Qkaz0yMuTgHmfKrFl.wXvllM42FLN_oeBr2JbofL0',
        clientSecret: process.env.CLIENT_SECRET || '053A9F370345DCD35A7653A9B707DD903E2F00B2A251DCBCE20B1EC759FC6C9E',
        redirectUri: `${baseUrl}/auth/callback`,
        loginUrl: loginUrl
    });
}

// 1. Login Route: User ko Salesforce ke login page par bhejega
app.get('/auth/login', (req, res) => {
    const oauth2 = getOAuth2(req);
    res.redirect(oauth2.getAuthorizationUrl({ scope: 'api refresh_token offline_access' }));
});

// 2. Callback Route: Salesforce login hone ke baad token yahan aayega
app.get('/auth/callback', async (req, res) => {
    const oauth2 = getOAuth2(req);
    const conn = new jsforce.Connection({ oauth2 : oauth2 });
    try {
        await conn.authorize(req.query.code);
        // User ka token session mein save kar liya
        req.session.accessToken = conn.accessToken;
        req.session.instanceUrl = conn.instanceUrl;
        res.redirect('/'); // Wapas UI par bhej do
    } catch (err) {
        res.send('Login Failed: ' + err.message);
    }
});

// 3. Check Auth Route: Frontend ko batayega ki user logged in hai ya nahi
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
// THE GOD MODE SCANNER API
// ==========================================
app.post('/api/scan', async (req, res) => {
    // Check if user is logged in via Salesforce
    if (!req.session.accessToken) {
        return res.status(401).json({ error: 'Unauthorized. Please login first.' });
    }

    const searchTerm = req.body.searchTerm;
    if (!searchTerm || searchTerm.length < 2) {
        return res.status(400).json({ error: 'Search term must be at least 2 characters.' });
    }

    // Connection Session Token se banega
    const conn = new jsforce.Connection({
        instanceUrl: req.session.instanceUrl,
        accessToken: req.session.accessToken
    });

    let matches = [];
    const searchLower = searchTerm.toLowerCase();
    const soqlLike = `%${searchTerm}%`;

    try {
        console.log(`✅ Scanning Org: ${conn.instanceUrl} | Term: ${searchTerm}`);

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

        // 5. RECORDS (SOSL & SOQL)
        try {
            const sosl = await conn.search(`FIND {*${searchTerm}*} IN ALL FIELDS RETURNING Account(Id, Name), Contact(Id, Name), Lead(Id, Name)`);
            if (sosl.searchRecords) for (let rec of sosl.searchRecords) matches.push({ type: `Record: ${rec.attributes.type}`, name: rec.Name, detail: `ID: ${rec.Id}`, link: `/${rec.Id}` });
            
            const opps = await conn.query(`SELECT Id, Name, StageName FROM Opportunity WHERE StageName LIKE '${soqlLike}' OR Name LIKE '${soqlLike}' LIMIT 50`);
            for (let rec of opps.records) matches.push({ type: 'Record: Opportunity', name: rec.Name, detail: `Stage: ${rec.StageName}`, link: `/${rec.Id}` });
        } catch (err) { console.debug('Records skip:', err.message); }

        res.json({ success: true, instanceUrl: conn.instanceUrl, matches: matches });

    } catch (err) {
        console.error('Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 SaaS Engine Started! Running on port ${PORT}\n`);
});