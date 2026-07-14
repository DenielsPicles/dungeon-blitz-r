#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULT_DUNGEON_BLITZ_SWF = path.join(
    'src', 'client', 'content', 'localhost', 'p', 'cbp', 'DungeonBlitz.swf'
);
const DEFAULT_UI_SWF = path.join(
    'src', 'client', 'content', 'localhost', 'p', 'cbp', 'UI_0.swf'
);
const DISCORD_TEXT_CHARACTER_ID = '244';
const DISCORD_ICON_CHARACTER_ID = '246';
const DISCORD_BUTTON_CHARACTER_ID = '249';

function parseArgs(argv) {
    const args = {
        ffdec: '',
        dungeonBlitzSwf: DEFAULT_DUNGEON_BLITZ_SWF,
        uiSwf: DEFAULT_UI_SWF,
        dungeonBlitzOnly: false,
        verify: false
    };

    for (let index = 2; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--ffdec' || arg === '-f') {
            args.ffdec = argv[++index] || '';
        } else if (arg === '--dungeonblitz-swf') {
            args.dungeonBlitzSwf = argv[++index] || '';
        } else if (arg === '--ui-swf') {
            args.uiSwf = argv[++index] || '';
        } else if (arg === '--dungeonblitz-only') {
            args.dungeonBlitzOnly = true;
        } else if (arg === '--verify') {
            args.verify = true;
        } else if (arg === '--help' || arg === '-h') {
            console.log([
                'Usage:',
                '  node src/server/scripts/patch-dungeonblitz-discord-account-ui.js [--verify]',
                '    [--dungeonblitz-swf <path>] [--ui-swf <path>] [--dungeonblitz-only] [--ffdec <path>]',
                '',
                'Replaces the Facebook Like button with Discord quick login and redirects',
                'the legacy in-game account form to Discord OAuth.'
            ].join('\n'));
            process.exit(0);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return args;
}

function resolveRepoRoot() {
    return path.resolve(__dirname, '..', '..', '..');
}

function resolvePath(repoRoot, value) {
    return path.isAbsolute(value) ? value : path.join(repoRoot, value);
}

function detectFfdec(repoRoot, preferred) {
    const candidates = [
        preferred ? resolvePath(repoRoot, preferred) : '',
        path.join(repoRoot, 'build', 'ffdec', 'ffdec.sh'),
        path.join(repoRoot, 'build', 'ffdec', 'ffdec.jar'),
        path.join(repoRoot, 'build', 'ffdec', 'ffdec-cli.jar'),
        '/Applications/FFDec.app/Contents/Resources/ffdec.sh',
        '/Applications/FFDec.app/Contents/Resources/ffdec.jar',
        '/Applications/FFDec.app/Contents/Resources/ffdec-cli.jar'
    ];

    return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || '';
}

function runFfdec(ffdecPath, args) {
    const resolved = path.resolve(ffdecPath);
    if (path.extname(resolved).toLowerCase() === '.jar') {
        execFileSync('java', ['-jar', resolved, '-cli', ...args], { stdio: 'inherit' });
        return;
    }
    execFileSync(resolved, ['-cli', ...args], { stdio: 'inherit' });
}

function normalizeSource(source) {
    return source.replace(/\r\n/g, '\n');
}

function replaceOnce(source, before, after, label) {
    const first = source.indexOf(before);
    if (first === -1) {
        throw new Error(`Could not find ${label}. The client source layout changed.`);
    }
    if (source.indexOf(before, first + before.length) !== -1) {
        throw new Error(`Found more than one ${label}. Refusing an ambiguous patch.`);
    }
    return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceFunction(source, signature, nextSignature, replacement) {
    const start = source.indexOf(signature);
    const end = source.indexOf(nextSignature, start + signature.length);
    if (start === -1 || end === -1 || end <= start) {
        throw new Error(`Could not isolate ${signature}. The client source layout changed.`);
    }
    return source.slice(0, start) + replacement + '\n      ' + source.slice(end);
}

function addDiscordImports(source) {
    if (!source.includes('import flash.external.ExternalInterface;')) {
        source = replaceOnce(
            source,
            'import flash.events.MouseEvent;\n',
            'import flash.events.MouseEvent;\n   import flash.external.ExternalInterface;\n   import flash.net.URLRequest;\n   import flash.net.navigateToURL;\n',
            'MouseEvent import'
        );
    }
    return source;
}

function discordOAuthBody(indent) {
    return [
        `${indent}if(ExternalInterface.available)`,
        `${indent}{`,
        `${indent}   ExternalInterface.call("openDiscordLogin");`,
        `${indent}}`,
        `${indent}else`,
        `${indent}{`,
        `${indent}   navigateToURL(new URLRequest("/auth/discord"),"_blank");`,
        `${indent}}`
    ].join('\n');
}

function patchLinkBar(source) {
    source = addDiscordImports(normalizeSource(source));
    const oldRefresh = [
        'if(var_1.mbPageIsLiked)',
        '         {',
        '            this.var_1986.Hide();',
        '            this.var_1935.Show();',
        '         }',
        '         else',
        '         {',
        '            this.var_1986.Show();',
        '            this.var_1935.Hide();',
        '         }'
    ].join('\n');
    const discordRefresh = [
        'this.var_1986.Show();',
        '         this.var_1935.Hide();'
    ].join('\n');
    if (source.includes(oldRefresh)) {
        source = replaceOnce(source, oldRefresh, discordRefresh, 'Facebook Like/Invite refresh block');
    } else if (!source.includes(discordRefresh)) {
        throw new Error('Could not find either original or patched Facebook Like/Invite refresh block.');
    }

    const callbackRegistration = [
        'if(ExternalInterface.available)',
        '         {',
        '            ExternalInterface.addCallback("SWFDiscordOAuthLogin",this.SWFDiscordOAuthLogin);',
        '         }',
        '         if(Boolean(var_1.main.root.loaderInfo.parameters.oauth))',
        '         {',
        '            this.SWFDiscordOAuthLogin();',
        '         }'
    ].join('\n');
    if (!source.includes('ExternalInterface.addCallback("SWFDiscordOAuthLogin",this.SWFDiscordOAuthLogin);')) {
        source = replaceOnce(
            source,
            'method_10(var_2.am_News,this.method_1760);',
            `${callbackRegistration}\n         method_10(var_2.am_News,this.method_1760);`,
            'link-bar ExternalInterface callback registration'
        );
    }

    const quickLoginCallback = [
        'public function SWFDiscordOAuthLogin(param1:String = "") : Boolean',
        '      {',
        '         if(var_1.gameState != Game.STATE_LOGIN)',
        '         {',
        '            return false;',
        '         }',
        '         var_1.var_2020 = false;',
        '         var_1.var_612 = false;',
        '         var_1.var_1198 = false;',
        '         var_1.var_2098 = false;',
        '         var_1.var_2138 = false;',
        '         var_1.var_2056 = false;',
        '         var_1.var_1447 = null;',
        '         var_1.var_1257 = null;',
        '         var_1.var_1909 = null;',
        '         var_1.var_355 = null;',
        '         if(var_1.serverConn)',
        '         {',
        '            var_1.serverConn.method_205();',
        '            var_1.serverConn = null;',
        '         }',
        '         var_1.var_94.method_71("Completing Discord login...");',
        '         var_1.method_429(true);',
        '         return true;',
        '      }'
    ].join('\n');
    if (!source.includes('public function SWFDiscordOAuthLogin(param1:String = "") : Boolean')) {
        source = replaceOnce(
            source,
            'private function method_1174(param1:MouseEvent) : void',
            `${quickLoginCallback}\n      \n      private function method_1174(param1:MouseEvent) : void`,
            'link-bar Discord OAuth quick-login callback'
        );
    }

    const replacement = [
        'private function method_1174(param1:MouseEvent) : void',
        '      {',
        '         this.SWFDiscordOAuthLogin();',
        discordOAuthBody('         '),
        '      }'
    ].join('\n');
    const callbackStart = source.indexOf('private function method_1174(param1:MouseEvent) : void');
    const callbackEnd = source.indexOf('private function method_1486(param1:MouseEvent) : void', callbackStart);
    const callback = callbackStart >= 0 && callbackEnd > callbackStart
        ? source.slice(callbackStart, callbackEnd)
        : '';
    if (callback.includes('this.SWFDiscordOAuthLogin();') &&
        callback.includes('ExternalInterface.call("openDiscordLogin");') &&
        !callback.includes('facebook.com')) {
        return source;
    }
    return replaceFunction(
        source,
        'private function method_1174(param1:MouseEvent) : void',
        'private function method_1486(param1:MouseEvent) : void',
        replacement
    );
}

function patchClassSelection(source) {
    source = addDiscordImports(normalizeSource(source));
    const methodStart = source.indexOf('public function method_223() : void');
    const methodEnd = source.indexOf('public function Display() : void', methodStart);
    let method = methodStart >= 0 && methodEnd > methodStart
        ? source.slice(methodStart, methodEnd)
        : '';
    if (method.includes('if(!this.var_1.var_355)') &&
        method.includes('ExternalInterface.call("openDiscordLogin");') &&
        method.includes('Create your account with Discord')) {
        return source;
    }
    if (method.includes('if(!this.var_1.serverConn)') &&
        method.includes('ExternalInterface.call("openDiscordLogin");')) {
        const patchedMethod = method.replace(
            'if(!this.var_1.serverConn)',
            'if(!this.var_1.var_355)'
        );
        return source.slice(0, methodStart) + patchedMethod + source.slice(methodEnd);
    }
    const oldEntry = [
        'if(!this.var_1105)',
        '         {',
        '            return;',
        '         }'
    ].join('\n');
    const discordEntry = [
        oldEntry,
        '         if(!this.var_1.var_355)',
        '         {',
        discordOAuthBody('            '),
        '            this.var_1.var_94.method_71("Create your account with Discord, then return to the game.",false);',
        '            return;',
        '         }'
    ].join('\n');
    return replaceOnce(source, oldEntry, discordEntry, 'unauthenticated class-selection entry');
}

function patchNewAccount(source) {
    source = addDiscordImports(normalizeSource(source));
    const methodStart = source.indexOf('private function method_621() : void');
    const methodEnd = source.indexOf('private function UpdatePaperDoll() : void', methodStart);
    const method = methodStart >= 0 && methodEnd > methodStart
        ? source.slice(methodStart, methodEnd)
        : '';
    if (method.includes('ExternalInterface.call("openDiscordLogin");') &&
        method.includes('Create your account with Discord') &&
        !method.includes('method_267(')) {
        return source;
    }
    const replacement = [
        'private function method_621() : void',
        '      {',
        discordOAuthBody('         '),
        '         this.var_1.var_94.method_71("Create your account with Discord, then return to the game.",false);',
        '      }'
    ].join('\n');
    return replaceFunction(
        source,
        'private function method_621() : void',
        'private function UpdatePaperDoll() : void',
        replacement
    );
}

function exportClientClasses(ffdecPath, workRoot, swfPath) {
    fs.rmSync(workRoot, { recursive: true, force: true });
    fs.mkdirSync(workRoot, { recursive: true });
    runFfdec(ffdecPath, [
        '-selectclass',
        'class_48,class_51,ScreenNewAccount',
        '-export',
        'script',
        workRoot,
        swfPath
    ]);

    const scriptsRoot = path.join(workRoot, 'scripts');
    const files = {
        linkBar: path.join(scriptsRoot, 'class_48.as'),
        classSelection: path.join(scriptsRoot, 'class_51.as'),
        newAccount: path.join(scriptsRoot, 'ScreenNewAccount.as')
    };
    for (const classPath of Object.values(files)) {
        if (!fs.existsSync(classPath)) {
            throw new Error(`FFDec export did not produce ${classPath}`);
        }
    }
    return { scriptsRoot, files };
}

function patchDungeonBlitzSwf(repoRoot, ffdecPath, swfPath) {
    const workRoot = path.join(repoRoot, 'build', 'ffdec-dungeonblitz-discord-account-ui', 'DungeonBlitz');
    const patchedSwfPath = path.join(workRoot, 'DungeonBlitz.patched.swf');
    const exported = exportClientClasses(ffdecPath, workRoot, swfPath);
    let changed = false;

    const applySourcePatch = (sourcePath, patcher) => {
        const original = fs.readFileSync(sourcePath, 'utf8');
        const patched = patcher(original);
        if (normalizeSource(original) === normalizeSource(patched)) {
            return;
        }
        fs.writeFileSync(sourcePath, patched);
        changed = true;
    };

    applySourcePatch(exported.files.linkBar, patchLinkBar);
    applySourcePatch(exported.files.classSelection, patchClassSelection);
    applySourcePatch(exported.files.newAccount, patchNewAccount);

    if (!changed) {
        console.log(`Discord account UI already patched in ${swfPath}`);
        return false;
    }

    runFfdec(ffdecPath, ['-importScript', swfPath, patchedSwfPath, exported.scriptsRoot]);
    fs.copyFileSync(patchedSwfPath, swfPath);
    return true;
}

function discordTextDefinition() {
    return [
        '[',
        'xmin -40',
        'ymin -40',
        'xmax 1710',
        'ymax 887',
        'readonly 1',
        'noselect 1',
        'useoutlines 1',
        'font 1',
        'height 440',
        'color #fffefefe',
        'align left',
        'leftmargin 0',
        'rightmargin 0',
        'indent 0',
        'leading 40',
        ']Discord'
    ].join('\n');
}

function patchUiSwf(repoRoot, ffdecPath, uiSwfPath) {
    const workRoot = path.join(repoRoot, 'build', 'ffdec-dungeonblitz-discord-account-ui', 'UI_0');
    const textPath = path.join(workRoot, 'Discord.txt');
    const textPatchedPath = path.join(workRoot, 'UI_0.discord-text.swf');
    const patchedPath = path.join(workRoot, 'UI_0.patched.swf');
    const iconPath = path.join(repoRoot, 'src', 'server', 'scripts', 'assets', 'discord-login-icon.svg');
    fs.rmSync(workRoot, { recursive: true, force: true });
    fs.mkdirSync(workRoot, { recursive: true });
    fs.writeFileSync(textPath, discordTextDefinition());

    runFfdec(ffdecPath, ['-replace', uiSwfPath, textPatchedPath, DISCORD_TEXT_CHARACTER_ID, textPath]);
    runFfdec(ffdecPath, ['-replace', textPatchedPath, patchedPath, DISCORD_ICON_CHARACTER_ID, iconPath]);
    fs.copyFileSync(patchedPath, uiSwfPath);
}

function verifyClientSources(repoRoot, ffdecPath, swfPath) {
    const workRoot = path.join(repoRoot, 'build', 'ffdec-dungeonblitz-discord-account-ui-verify', 'DungeonBlitz');
    const exported = exportClientClasses(ffdecPath, workRoot, swfPath);
    const linkBar = normalizeSource(fs.readFileSync(exported.files.linkBar, 'utf8'));
    const classSelection = normalizeSource(fs.readFileSync(exported.files.classSelection, 'utf8'));
    const newAccount = normalizeSource(fs.readFileSync(exported.files.newAccount, 'utf8'));

    const linkOAuthCallback = linkBar.slice(
        linkBar.indexOf('public function SWFDiscordOAuthLogin'),
        linkBar.indexOf('private function method_1174')
    );
    if (!linkBar.includes('ExternalInterface.addCallback("SWFDiscordOAuthLogin",this.SWFDiscordOAuthLogin);') ||
        !linkBar.includes('var_1.main.root.loaderInfo.parameters.oauth') ||
        !linkOAuthCallback.includes('var_1.serverConn.method_205();') ||
        !linkOAuthCallback.includes('var_1.serverConn = null;') ||
        !linkOAuthCallback.includes('var_1.var_355 = null;') ||
        !linkOAuthCallback.includes('var_1.method_429(true);') ||
        !linkBar.includes('ExternalInterface.call("openDiscordLogin");') ||
        !linkBar.includes('navigateToURL(new URLRequest("/auth/discord"),"_blank");') ||
        !linkBar.includes('this.var_1986.Show();\n         this.var_1935.Hide();')) {
        throw new Error('DungeonBlitz.swf does not contain the permanent Discord quick-login link-bar behavior.');
    }
    const linkCallback = linkBar.slice(
        linkBar.indexOf('private function method_1174'),
        linkBar.indexOf('private function method_1486')
    );
    if (!linkCallback.includes('this.SWFDiscordOAuthLogin();') ||
        linkCallback.includes('facebook.com') || linkCallback.includes('mbPageIsLiked')) {
        throw new Error('DungeonBlitz.swf still contains Facebook behavior in the replaced button callback.');
    }
    const classSelectionMethod = classSelection.slice(
        classSelection.indexOf('public function method_223'),
        classSelection.indexOf('public function Display')
    );
    if (!classSelectionMethod.includes('if(!this.var_1.var_355)') ||
        !classSelectionMethod.includes('ExternalInterface.call("openDiscordLogin");') ||
        !classSelectionMethod.includes('return;')) {
        throw new Error('The unauthenticated class-selection flow is not redirected to Discord OAuth.');
    }
    const newAccountMethod = newAccount.slice(
        newAccount.indexOf('private function method_621'),
        newAccount.indexOf('private function UpdatePaperDoll')
    );
    if (!newAccountMethod.includes('ExternalInterface.call("openDiscordLogin");') ||
        newAccountMethod.includes('method_267(')) {
        throw new Error('The legacy new-account submit path can still create an account in game.');
    }
}

function verifyUi(repoRoot, ffdecPath, uiSwfPath) {
    const workRoot = path.join(repoRoot, 'build', 'ffdec-dungeonblitz-discord-account-ui-verify', 'UI_0');
    const textRoot = path.join(workRoot, 'text');
    const shapeRoot = path.join(workRoot, 'shape');
    const spriteRoot = path.join(workRoot, 'sprite');
    fs.rmSync(workRoot, { recursive: true, force: true });
    fs.mkdirSync(workRoot, { recursive: true });
    runFfdec(ffdecPath, ['-selectid', DISCORD_TEXT_CHARACTER_ID, '-format', 'text:formatted', '-export', 'text', textRoot, uiSwfPath]);
    runFfdec(ffdecPath, ['-selectid', DISCORD_ICON_CHARACTER_ID, '-format', 'shape:svg', '-export', 'shape', shapeRoot, uiSwfPath]);
    runFfdec(ffdecPath, ['-selectid', DISCORD_BUTTON_CHARACTER_ID, '-export', 'sprite', spriteRoot, uiSwfPath]);

    const text = fs.readFileSync(path.join(textRoot, `${DISCORD_TEXT_CHARACTER_ID}.txt`), 'utf8');
    const shape = fs.readFileSync(path.join(shapeRoot, `${DISCORD_ICON_CHARACTER_ID}.svg`), 'utf8').toLowerCase();
    const spriteDir = path.join(spriteRoot, `DefineSprite_${DISCORD_BUTTON_CHARACTER_ID}`);
    const frames = fs.existsSync(spriteDir)
        ? fs.readdirSync(spriteDir).filter((entry) => entry.endsWith('.png'))
        : [];
    if (!text.includes(']Discord')) {
        throw new Error('UI_0.swf button text is not Discord.');
    }
    if (!shape.includes('#5865f2') || !shape.includes('#ffffff')) {
        throw new Error('UI_0.swf does not contain the Discord icon colors.');
    }
    if (frames.length !== 3) {
        throw new Error(`Expected three Discord button frames, found ${frames.length}.`);
    }
    console.log(`Verified Discord button frames in ${spriteDir}`);
}

function main() {
    const repoRoot = resolveRepoRoot();
    const args = parseArgs(process.argv);
    const ffdecPath = detectFfdec(repoRoot, args.ffdec);
    if (!ffdecPath) {
        throw new Error('FFDec not found. Pass --ffdec or install JPEXS FFDec.');
    }

    const dungeonBlitzSwf = resolvePath(repoRoot, args.dungeonBlitzSwf);
    const uiSwf = resolvePath(repoRoot, args.uiSwf);
    const targets = args.dungeonBlitzOnly ? [dungeonBlitzSwf] : [dungeonBlitzSwf, uiSwf];
    for (const target of targets) {
        if (!fs.existsSync(target)) {
            throw new Error(`SWF not found: ${target}`);
        }
    }

    if (!args.verify) {
        const dungeonBlitzChanged = patchDungeonBlitzSwf(repoRoot, ffdecPath, dungeonBlitzSwf);
        if (!args.dungeonBlitzOnly) {
            patchUiSwf(repoRoot, ffdecPath, uiSwf);
        }
        if (dungeonBlitzChanged || !args.dungeonBlitzOnly) {
            console.log(
                args.dungeonBlitzOnly
                    ? `Patched Discord account UI in ${dungeonBlitzSwf}`
                    : `Patched Discord account UI in ${dungeonBlitzSwf} and ${uiSwf}`
            );
        }
    }
    verifyClientSources(repoRoot, ffdecPath, dungeonBlitzSwf);
    if (!args.dungeonBlitzOnly) {
        verifyUi(repoRoot, ffdecPath, uiSwf);
    }
}

try {
    main();
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
}
