const vscode = require('vscode');
const jsforce = require('jsforce');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    console.log('God Mode Scanner is now active!');

    let disposable = vscode.commands.registerCommand('salesforce-dev-scanner.runGodMode', async function () {
        
        // 1. VS Code ka Input Box kholna
        const searchTerm = await vscode.window.showInputBox({
            prompt: 'Enter Text, Variable, Name, Picklist, or Record to Scan',
            placeHolder: 'e.g., outcomeMessage, Closed Won, or phone number'
        });

        if (!searchTerm) { return; } 
        if (searchTerm.length < 2) {
            vscode.window.showErrorMessage('Please enter at least 2 characters.');
            return;
        }

        // 2. Output panel banana
        const outputChannel = vscode.window.createOutputChannel('FTR God Mode Scanner');
        outputChannel.show(); 
        outputChannel.appendLine('======================================================');
        outputChannel.appendLine(`🌌 INITIATING 360° ORG SCAN FOR: "${searchTerm}" 🌌`);
        outputChannel.appendLine('======================================================\n');

        // 3. Notification waala Progress Bar
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'God Mode Scanner Running...',
            cancellable: false
        }, async (progress) => {
            
            const conn = new jsforce.Connection({ loginUrl: 'https://login.salesforce.com' });
            
            // Aapke Credentials
            const username = 'devashish.singh272@agentforce.com'; 
            const password = '@Dev1234'; 
            const securityToken = 'sbkyWyCuJL5FQ2nRi9auabohk';

            try {
                progress.report({ increment: 10, message: 'Authenticating...' });
                await conn.login(username, password + securityToken);
                outputChannel.appendLine(`✅ Connected to: ${conn.instanceUrl}\n`);
                
                let matchFound = false;
                const searchLower = searchTerm.toLowerCase();
                const soqlLike = `%${searchTerm}%`;

                // --- 1. FLOWS ---
                progress.report({ increment: 10, message: 'Scanning Flows...' });
                outputChannel.appendLine('⏳ [1/8] Deep Scanning Flows...');
                try {
                    const flowQuery = await conn.tooling.query("SELECT Id, MasterLabel FROM Flow WHERE Status = 'Active' OR Status = 'Draft'");
                    for (let flow of flowQuery.records) {
                        try {
                            const singleFlow = await conn.tooling.query(`SELECT Metadata FROM Flow WHERE Id = '${flow.Id}'`);
                            if (singleFlow.records.length > 0 && singleFlow.records[0].Metadata) {
                                let flowDataString = JSON.stringify(singleFlow.records[0].Metadata).toLowerCase();
                                if (flowDataString.includes(searchLower)) {
                                    outputChannel.appendLine(`  🟣 [FLOW] -> Name: ${flow.MasterLabel}`);
                                    matchFound = true;
                                }
                            }
                        } catch (innerErr) { console.debug(innerErr.message); }
                    }
                } catch (err) { outputChannel.appendLine(`  ⚠️ Flow scan issue: ${err.message}`); }

                // --- 2. LWC & AURA ---
                progress.report({ increment: 15, message: 'Scanning LWC & Aura...' });
                outputChannel.appendLine('⏳ [2/8] Scanning LWC & Aura...');
                try {
                    const lwcResult = await conn.tooling.query('SELECT LightningComponentBundle.DeveloperName, FilePath, Source FROM LightningComponentResource');
                    for (let rec of lwcResult.records) {
                        if (rec.Source && rec.Source.toLowerCase().includes(searchLower)) {
                            let name = rec.LightningComponentBundle ? rec.LightningComponentBundle.DeveloperName : 'Unknown';
                            outputChannel.appendLine(`  🟢 [LWC] -> Component: ${name} | File: ${rec.FilePath.split('/').pop()}`);
                            matchFound = true;
                        }
                    }
                    const auraResult = await conn.tooling.query('SELECT AuraDefinitionBundle.DeveloperName, DefType, Source FROM AuraDefinition');
                    for (let rec of auraResult.records) {
                        if (rec.Source && rec.Source.toLowerCase().includes(searchLower)) {
                            let name = rec.AuraDefinitionBundle ? rec.AuraDefinitionBundle.DeveloperName : 'Unknown';
                            outputChannel.appendLine(`  🔵 [AURA] -> Component: ${name} | Type: ${rec.DefType}`);
                            matchFound = true;
                        }
                    }
                } catch (err) { console.debug(err.message); }

                // --- 3. APEX & VF ---
                progress.report({ increment: 15, message: 'Scanning Apex & VF...' });
                outputChannel.appendLine('⏳ [3/8] Scanning Apex, Triggers & Visualforce...');
                try {
                    const apexResult = await conn.query('SELECT Name, Body FROM ApexClass');
                    for (let rec of apexResult.records) { if (rec.Body && rec.Body.toLowerCase().includes(searchLower)) { outputChannel.appendLine(`  🟠 [APEX] -> Class: ${rec.Name}`); matchFound = true; } }
                    
                    const triggerResult = await conn.query('SELECT Name, Body FROM ApexTrigger');
                    for (let rec of triggerResult.records) { if (rec.Body && rec.Body.toLowerCase().includes(searchLower)) { outputChannel.appendLine(`  🟠 [TRIGGER] -> Trigger: ${rec.Name}`); matchFound = true; } }
                    
                    const vfResult = await conn.query('SELECT Name, Markup FROM ApexPage');
                    for (let rec of vfResult.records) { if (rec.Markup && rec.Markup.toLowerCase().includes(searchLower)) { outputChannel.appendLine(`  🟡 [VF] -> Page: ${rec.Name}`); matchFound = true; } }
                } catch (err) { console.debug(err.message); }

                // --- 4. SCHEMA ---
                progress.report({ increment: 15, message: 'Scanning Schema...' });
                outputChannel.appendLine('⏳ [4/8] Scanning Schema & Picklists...');
                try {
                    const stageResult = await conn.query(`SELECT MasterLabel FROM OpportunityStage WHERE MasterLabel LIKE '${soqlLike}'`);
                    for (let rec of stageResult.records) { outputChannel.appendLine(`  ⚙️ [SCHEMA] -> Opportunity Stage: ${rec.MasterLabel}`); matchFound = true; }
                    const objResult = await conn.tooling.query('SELECT DeveloperName FROM CustomObject');
                    for (let rec of objResult.records) { if (rec.DeveloperName && rec.DeveloperName.toLowerCase().includes(searchLower)) { outputChannel.appendLine(`  📦 [OBJECT] -> ${rec.DeveloperName}__c`); matchFound = true; } }
                } catch (err) { console.debug(err.message); }

                // --- 5. LABELS ---
                progress.report({ increment: 10, message: 'Scanning Custom Labels...' });
                outputChannel.appendLine('⏳ [5/8] Scanning Custom Labels...');
                try {
                    const labelResult = await conn.tooling.query('SELECT Name, Value FROM ExternalString');
                    for (let rec of labelResult.records) { if ((rec.Name && rec.Name.toLowerCase().includes(searchLower)) || (rec.Value && rec.Value.toLowerCase().includes(searchLower))) { outputChannel.appendLine(`  🏷️ [LABEL] -> ${rec.Name}: ${rec.Value}`); matchFound = true; } }
                } catch (err) { console.debug(err.message); }

                // --- 6. USERS ---
                progress.report({ increment: 10, message: 'Scanning Users...' });
                outputChannel.appendLine('⏳ [6/8] Scanning Users...');
                try {
                    const userResult = await conn.query('SELECT Name, Email FROM User WHERE IsActive = true');
                    for (let rec of userResult.records) { if ((rec.Name && rec.Name.toLowerCase().includes(searchLower)) || (rec.Email && rec.Email.toLowerCase().includes(searchLower))) { outputChannel.appendLine(`  👤 [USER] -> ${rec.Name} | ${rec.Email}`); matchFound = true; } }
                } catch (err) { console.debug(err.message); }

                // --- 7. DATA RECORDS ---
                progress.report({ increment: 15, message: 'Scanning Records...' });
                outputChannel.appendLine('⏳ [7/8] Scanning Live Data Records...');
                try {
                    const soslResult = await conn.search(`FIND {*${searchTerm}*} IN ALL FIELDS RETURNING Account(Id, Name), Contact(Id, Name), Lead(Id, Name)`);
                    if (soslResult.searchRecords) { for (let rec of soslResult.searchRecords) { outputChannel.appendLine(`  🗃️ [RECORD] -> ${rec.attributes.type} | Name: ${rec.Name} | ID: ${rec.Id}`); matchFound = true; } }
                    
                    const opps = await conn.query(`SELECT Id, Name, StageName FROM Opportunity WHERE StageName LIKE '${soqlLike}' OR Name LIKE '${soqlLike}' LIMIT 100`);
                    for (let rec of opps.records) { outputChannel.appendLine(`  🗃️ [RECORD] -> Opportunity | Name: ${rec.Name} | Stage: ${rec.StageName} | ID: ${rec.Id}`); matchFound = true; }
                } catch (err) { console.debug(err.message); }

                // --- FINISH ---
                outputChannel.appendLine('\n--------------------------------------------------');
                if (!matchFound) {
                    outputChannel.appendLine(`✅ ALL CLEAR: "${searchTerm}" does not exist in this org.`);
                    vscode.window.showInformationMessage('God Mode: All Clear! No matches found.');
                } else {
                    outputChannel.appendLine(`🚨 God Mode Scan Complete. Matches listed above.`);
                    vscode.window.showInformationMessage('God Mode: Matches found! Check the Output panel.');
                }

            } catch (err) {
                vscode.window.showErrorMessage(`Scanner Error: ${err.message}`);
                outputChannel.appendLine(`\n❌ ERROR: ${err.message}`);
            }
        });
    });

    context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};