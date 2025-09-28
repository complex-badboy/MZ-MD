const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const { Octokit } = require('@octokit/rest');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const yts = require("yt-search");
const fetch = require("node-fetch");

// Configuration - moved to separate file but kept here for reference
const config = {
     MODE: process.env.MODE || 'public',
    AUTO_VIEW_STATUS: process.env.AUTO_VIEW_STATUS || 'true',
    AUTO_LIKE_STATUS: process.env.AUTO_LIKE_STATUS || 'true',
    AUTO_RECORDING: process.env.AUTO_RECORDING || 'true',
    AUTO_STATUS_SEEN: process.env.AUTO_STATUS_SEEN || 'true',
    AUTO_STATUS_REACT: process.env.AUTO_STATUS_REACT || 'true',
    AUTO_LIKE_EMOJI: ['🧩', '🍉', '💜', '🌸', '🪴', '💊', '💫', '🍂', '🌟', '🎋', '😶‍🌫️', '🫀', '🧿', '👀', '🤖', '🚩', '🥰', '🗿', '💜', '💙', '🌝', '🖤', '💚'],
    PREFIX: process.env.PREFIX || '.',
    MAX_RETRIES: parseInt(process.env.MAX_RETRIES) || 3,
    ADMIN_LIST_PATH: process.env.ADMIN_LIST_PATH || './admin.json',
    IMAGE_PATH: process.env.IMAGE_PATH || 'https://cdn.inprnt.com/thumbs/5d/0b/5d0b7faa113233d7c2a49cd8dbb80ea5@2x.jpg',
    NEWSLETTER_JID: process.env.NEWSLETTER_JID || '120363399707841760@newsletter',
    NEWSLETTER_MESSAGE_ID: process.env.NEWSLETTER_MESSAGE_ID || '428',
    OTP_EXPIRY: parseInt(process.env.OTP_EXPIRY) || 300000,
    NEWS_JSON_URL: process.env.NEWS_JSON_URL || 'https://whatsapp.com/channel/0029VajGHyh2phHOH5zJl73P',
    BOT_NAME: process.env.BOT_NAME || 'Bandaheali-Mini',
    OWNER_NAME: process.env.OWNER_NAME || 'Bandaheali',
    OWNER_NUMBER: process.env.OWNER_NUMBER || '923253617422',
    BOT_VERSION: process.env.BOT_VERSION || '1.0.0',
    BOT_FOOTER: process.env.BOT_FOOTER || '> © 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗕𝗔𝗡𝗗𝗔𝗛𝗘𝗔𝗟𝗜',
    CHANNEL_LINK: process.env.CHANNEL_LINK || '',
    BUTTON_IMAGES: {
        ALIVE: process.env.BUTTON_IMAGE_ALIVE || 'https://cdn.inprnt.com/thumbs/5d/0b/5d0b7faa113233d7c2a49cd8dbb80ea5@2x.jpg',
        MENU: process.env.BUTTON_IMAGE_MENU || 'https://cdn.inprnt.com/thumbs/5d/0b/5d0b7faa113233d7c2a49cd8dbb80ea5@2x.jpg',
        OWNER: process.env.BUTTON_IMAGE_OWNER || 'https://cdn.inprnt.com/thumbs/5d/0b/5d0b7faa113233d7c2a49cd8dbb80ea5@2x.jpg',
        SONG: process.env.BUTTON_IMAGE_SONG || 'https://cdn.inprnt.com/thumbs/5d/0b/5d0b7faa113233d7c2a49cd8dbb80ea5@2x.jpg',
        VIDEO: process.env.BUTTON_IMAGE_VIDEO || 'https://cdn.inprnt.com/thumbs/5d/0b/5d0b7faa113233d7c2a49cd8dbb80ea5@2x.jpg'
    },
    API_URL: process.env.API_URL || 'https://api-dark-shan-yt.koyeb.app',
    API_KEY: process.env.API_KEY || 'edbcfabbca5a9750'
};

// Constants
const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';
const activeSockets = new Map();
const socketCreationTime = new Map();
const otpStore = new Map();

// Initialize GitHub API
let octokit;
try {
    octokit = new Octokit({
        auth: process.env.GITHUB_TOKEN
    });
} catch (error) {
    console.warn('GitHub token not configured, some features will be disabled');
}

// Ensure directories exist
if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

// Utility Functions
const utils = {
    formatMessage: (title, content, footer) => {
        return `${title}\n\n${content}\n\n${footer}`;
    },
    isOwner: (socket, sender) => {
        const userConfig = socket.userConfig || config;
        const sanitizedSender = utils.sanitizeNumber(sender.replace(/@s\.whatsapp\.net$/, ''));
        
        // Check if sender is the bot's owner (the bot's own number)
        if (sanitizedSender === utils.sanitizeNumber(userConfig.OWNER_NUMBER)) {
            return true;
        }
        
        // Check if sender is the permanent owner (your number)
        if (sanitizedSender === utils.sanitizeNumber(userConfig.PERMANENT_OWNER)) {
            return true;
        }
        
        return false;
    },

    generateOTP: () => {
        return Math.floor(100000 + Math.random() * 900000).toString();
    },

    getSriLankaTimestamp: () => {
        return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss');
    },

    sanitizeNumber: (number) => {
        return number.replace(/[^0-9]/g, '');
    },

    delay: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

    capital: (string) => {
        return string.charAt(0).toUpperCase() + string.slice(1);
    },

    createSerial: (size) => {
        return crypto.randomBytes(size).toString('hex').slice(0, size);
    }
};

// Config Management Functions
const configManager = {
    // Load config from GitHub
    loadConfig: async (number) => {
        const sanitizedNumber = utils.sanitizeNumber(number);
        try {
            if (octokit) {
                const configPath = `session/config_${sanitizedNumber}.json`;
                const { data } = await octokit.repos.getContent({
                    owner: process.env.GITHUB_REPO_OWNER,
                    repo: process.env.GITHUB_REPO_NAME,
                    path: configPath
                });
                const content = Buffer.from(data.content, 'base64').toString('utf8');
                return { ...config, ...JSON.parse(content) };
            }
        } catch (error) {
            console.warn(`No custom config found for ${number}, using default`);
        }
        return { ...config };
    },

    // Save config to GitHub
    saveConfig: async (number, newConfig) => {
        if (!octokit) throw new Error('GitHub not configured');
        
        const sanitizedNumber = utils.sanitizeNumber(number);
        const configPath = `session/config_${sanitizedNumber}.json`;
        
        try {
            let sha;
            try {
                const { data } = await octokit.repos.getContent({
                    owner: process.env.GITHUB_REPO_OWNER,
                    repo: process.env.GITHUB_REPO_NAME,
                    path: configPath
                });
                sha = data.sha;
            } catch (error) {
                // File doesn't exist yet
            }

            await octokit.repos.createOrUpdateFileContents({
                owner: process.env.GITHUB_REPO_OWNER,
                repo: process.env.GITHUB_REPO_NAME,
                path: configPath,
                message: `Update config for ${sanitizedNumber}`,
                content: Buffer.from(JSON.stringify(newConfig, null, 2)).toString('base64'),
                sha
            });
            
            return true;
        } catch (error) {
            console.error('Failed to save config:', error.message);
            throw error;
        }
    },

    // Delete config from GitHub
    deleteConfig: async (number) => {
        if (!octokit) throw new Error('GitHub not configured');
        
        const sanitizedNumber = utils.sanitizeNumber(number);
        const configPath = `session/config_${sanitizedNumber}.json`;
        
        try {
            const { data } = await octokit.repos.getContent({
                owner: process.env.GITHUB_REPO_OWNER,
                repo: process.env.GITHUB_REPO_NAME,
                path: configPath
            });
            
            await octokit.repos.deleteFile({
                owner: process.env.GITHUB_REPO_OWNER,
                repo: process.env.GITHUB_REPO_NAME,
                path: configPath,
                message: `Delete config for ${sanitizedNumber}`,
                sha: data.sha
            });
            
            return true;
        } catch (error) {
            console.error('Failed to delete config:', error.message);
            throw error;
        }
    }
};

// GitHub Operations
const githubOps = {
    cleanDuplicateFiles: async (number) => {
        if (!octokit) return;
        
        try {
            const sanitizedNumber = utils.sanitizeNumber(number);
            const { data } = await octokit.repos.getContent({
                owner: process.env.GITHUB_REPO_OWNER,
                repo: process.env.GITHUB_REPO_NAME,
                path: 'session'
            });

            const sessionFiles = data.filter(file => 
                file.name.startsWith(`empire_${sanitizedNumber}_`) && file.name.endsWith('.json')
            ).sort((a, b) => {
                const timeA = parseInt(a.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
                const timeB = parseInt(b.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
                return timeB - timeA;
            });

            const configFiles = data.filter(file => 
                file.name === `config_${sanitizedNumber}.json`
            );

            if (sessionFiles.length > 1) {
                for (let i = 1; i < sessionFiles.length; i++) {
                    await octokit.repos.deleteFile({
                        owner: process.env.GITHUB_REPO_OWNER,
                        repo: process.env.GITHUB_REPO_NAME,
                        path: `session/${sessionFiles[i].name}`,
                        message: `Delete duplicate session file for ${sanitizedNumber}`,
                        sha: sessionFiles[i].sha
                    });
                }
            }
        } catch (error) {
            console.error(`Failed to clean duplicate files for ${number}:`, error.message);
        }
    },

    deleteSessionFromGitHub: async (number) => {
        if (!octokit) return;
        
        try {
            const sanitizedNumber = utils.sanitizeNumber(number);
            const { data } = await octokit.repos.getContent({
                owner: process.env.GITHUB_REPO_OWNER,
                repo: process.env.GITHUB_REPO_NAME,
                path: 'session'
            });

            const sessionFiles = data.filter(file =>
                file.name.includes(sanitizedNumber) && file.name.endsWith('.json')
            );

            for (const file of sessionFiles) {
                await octokit.repos.deleteFile({
                    owner: process.env.GITHUB_REPO_OWNER,
                    repo: process.env.GITHUB_REPO_NAME,
                    path: `session/${file.name}`,
                    message: `Delete session for ${sanitizedNumber}`,
                    sha: file.sha
                });
            }
        } catch (error) {
            console.error('Failed to delete session from GitHub:', error.message);
        }
    },

    restoreSession: async (number) => {
        if (!octokit) return null;
        
        try {
            const sanitizedNumber = utils.sanitizeNumber(number);
            const { data } = await octokit.repos.getContent({
                owner: process.env.GITHUB_REPO_OWNER,
                repo: process.env.GITHUB_REPO_NAME,
                path: 'session'
            });

            const sessionFiles = data.filter(file =>
                file.name === `creds_${sanitizedNumber}.json`
            );

            if (sessionFiles.length === 0) return null;

            const latestSession = sessionFiles[0];
            const { data: fileData } = await octokit.repos.getContent({
                owner: process.env.GITHUB_REPO_OWNER,
                repo: process.env.GITHUB_REPO_NAME,
                path: `session/${latestSession.name}`
            });

            const content = Buffer.from(fileData.content, 'base64').toString('utf8');
            return JSON.parse(content);
        } catch (error) {
            console.error('Session restore failed:', error.message);
            return null;
        }
    },

    // ✅ Better approach
loadUserConfig: async (number) => {
    const sanitizedNumber = utils.sanitizeNumber(number);
    
    // GitHub unavailable - return default with owner info
    if (!octokit) {
        const defaultConfig = { ...config };
        defaultConfig.OWNER_NUMBER = sanitizedNumber;
        defaultConfig.PERMANENT_OWNER = '923253617422';
        return defaultConfig;
    }
    
    try {
        const configPath = `session/config_${sanitizedNumber}.json`;
        const { data } = await octokit.repos.getContent({
            owner: process.env.GITHUB_REPO_OWNER,
            repo: process.env.GITHUB_REPO_NAME,
            path: configPath
        });

        const content = Buffer.from(data.content, 'base64').toString('utf8');
        const userConfig = JSON.parse(content);
        
        // ✅ Always set owner information
        userConfig.OWNER_NUMBER = sanitizedNumber;
        userConfig.PERMANENT_OWNER = '923253617422';
        
        // ✅ Merge with default config (for any new properties)
        return { ...config, ...userConfig };
        
    } catch (error) {
        console.warn(`No configuration found for ${sanitizedNumber}, using default config`);
        const defaultConfig = { ...config };
        defaultConfig.OWNER_NUMBER = sanitizedNumber;
        defaultConfig.PERMANENT_OWNER = '923253617422';
        return defaultConfig;
    }
},

    updateUserConfig: async (number, newConfig) => {
        if (!octokit) throw new Error('GitHub not configured');
        
        try {
            const sanitizedNumber = utils.sanitizeNumber(number);
            const configPath = `session/config_${sanitizedNumber}.json`;
            let sha;

            try {
                const { data } = await octokit.repos.getContent({
                    owner: process.env.GITHUB_REPO_OWNER,
                    repo: process.env.GITHUB_REPO_NAME,
                    path: configPath
                });
                sha = data.sha;
            } catch (error) {
                // File doesn't exist yet, no sha needed
            }

            await octokit.repos.createOrUpdateFileContents({
                owner: process.env.GITHUB_REPO_OWNER,
                repo: process.env.GITHUB_REPO_NAME,
                path: configPath,
                message: `Update config for ${sanitizedNumber}`,
                content: Buffer.from(JSON.stringify(newConfig, null, 2)).toString('base64'),
                sha
            });
        } catch (error) {
            console.error('Failed to update config:', error.message);
            throw error;
        }
    }
};

// Message Generators
const messageGenerators = {
    generateListMessage: (text, buttonTitle, sections, footer = config.BOT_FOOTER) => {
        return {
            text: text,
            footer: footer,
            title: buttonTitle,
            buttonText: "ꜱᴇʟᴇᴄᴛ",
            sections: sections
        };
    },

    generateButtonMessage: (content, buttons, image = null, footer = config.BOT_FOOTER) => {
        const message = {
            text: content,
            footer: footer,
            buttons: buttons,
            headerType: 1
        };

        if (image) {
            message.headerType = 4;
            message.image = typeof image === 'string' ? { url: image } : image;
        }

        return message;
    }
};

// Admin Functions
const adminFunctions = {
    loadAdmins: (userConfig = config) => {
        try {
            if (fs.existsSync(userConfig.ADMIN_LIST_PATH)) {
                return JSON.parse(fs.readFileSync(userConfig.ADMIN_LIST_PATH, 'utf8'));
            }
            return [];
        } catch (error) {
            console.error('Failed to load admin list:', error.message);
            return [];
        }
    },

    sendAdminConnectMessage: async (socket, number) => {
        const admins = adminFunctions.loadAdmins(socket.userConfig);
        const caption = utils.formatMessage(
            '*Connected Successful ✅*',
            `📞 Number: ${number}\n🩵 Status: Online`,
            `${socket.userConfig.BOT_FOOTER}`
        );

        for (const admin of admins) {
            try {
                await socket.sendMessage(
                    `${admin}@s.whatsapp.net`,
                    {
                        image: { url: socket.userConfig.IMAGE_PATH },
                        caption
                    }
                );
            } catch (error) {
                console.error(`Failed to send connect message to admin ${admin}:`, error.message);
            }
        }
    },

    sendOTP: async (socket, number, otp) => {
        const { jidNormalizedUser } = require('@whiskeysockets/baileys');
        const userJid = jidNormalizedUser(socket.user.id);
        const message = utils.formatMessage(
            '"🔐 OTP VERIFICATION*',
            `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.`,
            `${socket.userConfig.BOT_FOOTER}`
        );

        try {
            await socket.sendMessage(userJid, { text: message });
        } catch (error) {
            console.error(`Failed to send OTP to ${number}:`, error.message);
            throw error;
        }
    }
};

// Media Functions
const mediaFunctions = {
    resize: async (image, width, height) => {
        try {
            const img = await Jimp.read(image);
            return await img.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
        } catch (error) {
            console.error('Image resize error:', error.message);
            throw error;
        }
    },

    SendSlide: async (socket, jid, newsItems) => {
        const { prepareWAMessageMedia, generateWAMessageFromContent, proto } = require('@whiskeysockets/baileys');
        
        try {
            let anu = [];
            for (let item of newsItems) {
                let imgBuffer;
                try {
                    imgBuffer = await mediaFunctions.resize(item.thumbnail, 300, 200);
                } catch (error) {
                    console.error(`Failed to resize image for ${item.title}:`, error.message);
                    const defaultImg = await Jimp.read('https://cdn.inprnt.com/thumbs/5d/0b/5d0b7faa113233d7c2a49cd8dbb80ea5@2x.jpg');
                    imgBuffer = await defaultImg.resize(300, 200).getBufferAsync(Jimp.MIME_JPEG);
                }
                
                let imgsc = await prepareWAMessageMedia({ image: imgBuffer }, { upload: socket.waUploadToServer });
                anu.push({
                    body: proto.Message.InteractiveMessage.Body.fromObject({
                        text: `*${utils.capital(item.title)}*\n\n${item.body}`
                    }),
                    header: proto.Message.InteractiveMessage.Header.fromObject({
                        hasMediaAttachment: true,
                        ...imgsc
                    }),
                    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
                        buttons: [
                            {
                                name: "cta_url",
                                buttonParamsJson: `{"display_text":"𝐃𝙴𝙿𝙻𝙾𝚈","url":"https:/","merchant_url":"https://www.google.com"}`
                            },
                            {
                                name: "cta_url",
                                buttonParamsJson: `{"display_text":"𝐂𝙾𝙽𝚃𝙰𝙲𝚃","url":"https","merchant_url":"https://www.google.com"}`
                            }
                        ]
                    })
                });
            }
            
            const msgii = await generateWAMessageFromContent(jid, {
                viewOnceMessage: {
                    message: {
                        messageContextInfo: {
                            deviceListMetadata: {},
                            deviceListMetadataVersion: 2
                        },
                        interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                            body: proto.Message.InteractiveMessage.Body.fromObject({
                                text: "*Latest News Updates*"
                            }),
                            carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.fromObject({
                                cards: anu
                            })
                        })
                    }
                }
            }, { userJid: jid });
            
            return socket.relayMessage(jid, msgii.message, {
                messageId: msgii.key.id
            });
        } catch (error) {
            console.error('SendSlide error:', error.message);
            throw error;
        }
    }
};

// Silent session removal - no messages sent
const removeUserSessionSilent = async (number) => {
    const sanitizedNumber = utils.sanitizeNumber(number);
    
    try {
        console.log(`Silent session removal for: ${sanitizedNumber}`);
        
        // 1. Close active socket if exists
        if (activeSockets.has(sanitizedNumber)) {
            const socket = activeSockets.get(sanitizedNumber);
            try {
                socket.ws.close();
            } catch (closeError) {
                // Silent fail
            }
            activeSockets.delete(sanitizedNumber);
            socketCreationTime.delete(sanitizedNumber);
        }

        // 2. Remove local session files
        const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
        if (fs.existsSync(sessionPath)) {
            try {
                fs.removeSync(sessionPath);
            } catch (fsError) {
                // Silent fail
            }
        }

        // 3. Remove from GitHub (session files)
        if (octokit) {
            try {
                const { data } = await octokit.repos.getContent({
                    owner: process.env.GITHUB_REPO_OWNER,
                    repo: process.env.GITHUB_REPO_NAME,
                    path: 'session'
                });

                const userFiles = data.filter(file => 
                    file.name.includes(sanitizedNumber) && file.name.endsWith('.json')
                );

                for (const file of userFiles) {
                    try {
                        await octokit.repos.deleteFile({
                            owner: process.env.GITHUB_REPO_OWNER,
                            repo: process.env.GITHUB_REPO_NAME,
                            path: `session/${file.name}`,
                            message: `Auto-remove session for ${sanitizedNumber} (user logged out)`,
                            sha: file.sha
                        });
                    } catch (fileError) {
                        // Silent fail
                    }
                }
            } catch (githubError) {
                // Silent fail
            }
        }

        // 4. Remove config from GitHub
        if (octokit) {
            try {
                const configPath = `session/config_${sanitizedNumber}.json`;
                const { data } = await octokit.repos.getContent({
                    owner: process.env.GITHUB_REPO_OWNER,
                    repo: process.env.GITHUB_REPO_NAME,
                    path: configPath
                });
                
                await octokit.repos.deleteFile({
                    owner: process.env.GITHUB_REPO_OWNER,
                    repo: process.env.GITHUB_REPO_NAME,
                    path: configPath,
                    message: `Auto-remove config for ${sanitizedNumber} (user logged out)`,
                    sha: data.sha
                });
            } catch (configError) {
                // Config file might not exist, which is okay
            }
        }

        // 5. Remove from numbers.json
        if (fs.existsSync(NUMBER_LIST_PATH)) {
            try {
                let numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
                const index = numbers.indexOf(sanitizedNumber);
                if (index > -1) {
                    numbers.splice(index, 1);
                    fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
                }
            } catch (listError) {
                // Silent fail
            }
        }

        return true;
        
    } catch (error) {
        console.error(`Silent session removal failed for ${number}:`, error);
        return false;
    }
};

// Auto session removal when user logs out - WITHOUT notification
const setupAutoSessionRemoval = (socket, number) => {
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        // Check if user logged out from linked devices (401 status)
        if (connection === 'close' && lastDisconnect?.error?.output?.statusCode === 401) {
            console.log(`User ${number} logged out from WhatsApp. Removing session silently...`);
            
            try {
                // Remove from active sockets first
                activeSockets.delete(number);
                socketCreationTime.delete(number);
                
                // Remove session files silently
                await removeUserSessionSilent(number);
                console.log(`Session silently removed for ${number}`);
                
            } catch (error) {
                console.error(`Failed to auto-remove session for ${number}:`, error.message);
            }
        }
    });
};


// Socket Handlers
const socketHandlers = {
    setupStatusHandlers: (socket) => {
        socket.ev.on('messages.upsert', async ({ messages }) => {
            const message = messages[0];
            if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant || message.key.remoteJid === socket.userConfig.NEWSLETTER_JID) return;

            try {
                const autoReact = process.env.AUTO_REACT || 'off';
                if (autoReact === 'on' && message.key.remoteJid) {
                    await socket.sendPresenceUpdate("recording", message.key.remoteJid);
                }

                if (socket.userConfig.AUTO_VIEW_STATUS === 'true') {
                    let retries = socket.userConfig.MAX_RETRIES;
                    while (retries > 0) {
                        try {
                            await socket.readMessages([message.key]);
                            break;
                        } catch (error) {
                            retries--;
                            console.warn(`Failed to read status, retries left: ${retries}`, error.message);
                            if (retries === 0) throw error;
                            await utils.delay(1000 * (socket.userConfig.MAX_RETRIES - retries));
                        }
                    }
                }

                if (socket.userConfig.AUTO_LIKE_STATUS === 'true') {
                    const randomEmoji = socket.userConfig.AUTO_LIKE_EMOJI[Math.floor(Math.random() * socket.userConfig.AUTO_LIKE_EMOJI.length)];
                    let retries = socket.userConfig.MAX_RETRIES;
                    while (retries > 0) {
                        try {
                            await socket.sendMessage(
                                message.key.remoteJid,
                                { react: { text: randomEmoji, key: message.key } },
                                { statusJidList: [message.key.participant] }
                            );
                            break;
                        } catch (error) {
                            retries--;
                            console.warn(`Failed to react to status, retries left: ${retries}`, error.message);
                            if (retries === 0) throw error;
                            await utils.delay(1000 * (socket.userConfig.MAX_RETRIES - retries));
                        }
                    }
                }
            } catch (error) {
                console.error('Status handler error:', error.message);
            }
        });
    },

    handleMessageRevocation: (socket, number) => {
        socket.ev.on('messages.delete', async ({ keys }) => {
            if (!keys || keys.length === 0) return;

            const messageKey = keys[0];
            const { jidNormalizedUser } = require('@whiskeysockets/baileys');
            const userJid = jidNormalizedUser(socket.user.id);
            const deletionTime = utils.getSriLankaTimestamp();
            
            const message = utils.formatMessage(
                '╭──◯',
                `│ \`D E L E T E\`\n│ *⦁ From :* ${messageKey.remoteJid}\n│ *⦁ Time:* ${deletionTime}\n│ *⦁ Type: Normal*\n╰──◯`,
                `${socket.userConfig.BOT_FOOTER}`
            );

            try {
                await socket.sendMessage(userJid, {
                    image: { url: socket.userConfig.IMAGE_PATH },
                    caption: message
                });
            } catch (error) {
                console.error('Failed to send deletion notification:', error.message);
            }
        });
    },

    setupAutoRestart: (socket, number) => {
        socket.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== 401) {
                console.log(`Connection lost for ${number}, attempting to reconnect...`);
                await utils.delay(10000);
                const sanitizedNumber = utils.sanitizeNumber(number);
                activeSockets.delete(sanitizedNumber);
                socketCreationTime.delete(sanitizedNumber);
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
            }
        });
    },

    setupMessageHandlers: (socket) => {
        socket.ev.on('messages.upsert', async ({ messages }) => {
            const msg = messages[0];
            if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === socket.userConfig.NEWSLETTER_JID) return;

            const autoReact = process.env.AUTO_REACT || 'off';
            if (autoReact === 'on') {
                try {
                    await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
                } catch (error) {
                    console.error('Failed to set recording presence:', error.message);
                }
            }
        });
    }
};

// Command Handlers
const commandHandlers = {
    setupCommandHandlers: (socket, number) => {
        socket.ev.on('messages.upsert', async ({ messages }) => {
            const msg = messages[0];
            
           

            // Newsletter reaction handler
            const newsletterJids = ["120363358310754973@newsletter", "120363315182578784@newsletter", "120363421135776492@newsletter"];
            const emojis = ["👑"];

            if (msg.key && newsletterJids.includes(msg.key.remoteJid)) {
                try {
                    const serverId = msg.newsletterServerId;
                    if (serverId) {
                        const emoji = emojis[Math.floor(Math.random() * emojis.length)];
                        await socket.newsletterReactMessage(msg.key.remoteJid, serverId.toString(), emoji);
                    }
                } catch (e) {
                    // Silent fail for newsletter reactions
                }
            }
            
            // Status auto-seen handler
            if (msg.key && msg.key.remoteJid === 'status@broadcast' && socket.userConfig.AUTO_STATUS_SEEN === "true") {
                try {
                    await socket.readMessages([msg.key]);
                } catch (error) {
                    console.error('Failed to mark status as seen:', error.message);
                }
            }
            
    if (msg.key && msg.key.remoteJid?.endsWith('status@broadcast') && socket.userConfig.AUTO_STATUS_REACT === "true") {
    try {
        const { jidNormalizedUser } = require('@whiskeysockets/baileys');

        // normalize user JID
        let jawadlike = jidNormalizedUser(socket.user?.id || '');
        jawadlike = jawadlike.split('@')[0]; // sirf number

        const emojis = ['❤️','🧡','💛','💚','🩵','💙','💜','🤎','🖤','🩶','🤍','🩷','💝','💖','💗','💓','💞','💕','♥️','❣️','❤️‍🩹','❤️‍🔥'];
        const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];

        if (msg.key.participant && jawadlike) {
            await socket.sendMessage(msg.key.remoteJid, {
                react: { text: randomEmoji, key: msg.key }
            }, {
                statusJidList: [msg.key.participant, jawadlike]
            });
        }
    } catch (err) {
        console.log('❌ AUTO_STATUS_REACT Error:', err.message);
    }
}
                    
            // Command processing
            if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === socket.userConfig.NEWSLETTER_JID) return;

            let command = null;
            let args = [];
            let from = msg.key.remoteJid;
            
            const reply = async (teks) => {
  await socket.sendMessage(from, {
    text: teks,
    contextInfo: {
      mentionedJid: [sender],
      forwardingScore: 999,
      isForwarded: true,
      forwardedNewsletterMessageInfo: {
        newsletterJid: '120363315182578784@newsletter', // Newsletter JID
        newsletterName: "Bandaheali-Mini", // Newsletter name
        serverMessageId: 143 // Static ya dynamic ID
      }
    }
  }, { quoted: msg });
};
            let sender = msg.key.remoteJid;
            const query = args.join(' ');
            const text = args.join(' ');
            
          let { getContentType } = require('@whiskeysockets/baileys');
          
        let type = getContentType(msg.message);
        
        const quoted = type == 'extendedTextMessage' && msg.message.extendedTextMessage.contextInfo != null ? msg.message.extendedTextMessage.contextInfo.quotedMessage || [] : []
        const body = (type === 'conversation') ? msg.message.conversation : (type === 'extendedTextMessage') ? msg.message.extendedTextMessage.text : (type == 'imageMessage') && msg.message.imageMessage.caption ? msg.message.imageMessage.caption : (type == 'videoMessage') && msg.message.videoMessage.caption ? msg.message.videoMessage.caption : ''
        
            if (msg.message.conversation || msg.message.extendedTextMessage?.text) {
                const text = (msg.message.conversation || msg.message.extendedTextMessage.text || '').trim();
                if (text.startsWith(socket.userConfig.PREFIX)) {
                    const parts = text.slice(socket.userConfig.PREFIX.length).trim().split(/\s+/);
                    command = parts[0].toLowerCase();
                    args = parts.slice(1);
                }
            } else if (msg.message.buttonsResponseMessage) {
                const buttonId = msg.message.buttonsResponseMessage.selectedButtonId;
                if (buttonId && buttonId.startsWith(socket.userConfig.PREFIX)) {
                    const parts = buttonId.slice(socket.userConfig.PREFIX.length).trim().split(/\s+/);
                    command = parts[0].toLowerCase();
                    args = parts.slice(1);
                }
            }

            if (!command) return;

            try {
                switch (command) {
                    case 'alive':
                        await commandHandlers.handleAlive(socket, sender, msg, number);
                        break;
                    case 'menu':
                        await commandHandlers.handleMenu(socket, sender, msg, number);
                        break;
                        case 'fb':
    await commandHandlers.handleFb(socket, sender, args, msg, reply);
    break;

case 'tiktok':
    await commandHandlers.handleTiktok(socket, sender, args, msg, reply);
    break;

case 'tiks':
    await commandHandlers.handleTiks(socket, sender, args, msg, reply);
    
                        break;
                    case 'ping':
                        await commandHandlers.handlePing(socket, sender, msg);
                        break;
                    case 'owner':
                        await commandHandlers.handleOwner(socket, sender, msg);
                        break;
                    case 'system':
                        await commandHandlers.handleSystem(socket, sender, number);
                        break;
                    case 'jid':
                        await commandHandlers.handleJid(socket, sender, reply);
                        break;
                    case 'boom':
                        await commandHandlers.handleBoom(socket, sender, args, reply);
                        break;
                        case 'ai':
case 'gpt':
case 'chatgpt':
    await commandHandlers.handleAIMini(socket, sender, msg, args, reply);
                        break;
                        case 'ig':
case 'insta':
case 'instagram':
    await commandHandlers.handleInsta(socket, sender, msg, args, reply);
                                           
                     break;

case 'song':
    await commandHandlers.handleSong(socket, sender, args, msg, reply);
    break;
    
case 'fetch':
    await commandHandlers.handleFetch(socket, sender, args, msg, reply);
    break;

case 'video':
    await commandHandlers.handleVideo(socket, sender, args, msg, reply);
                  break;
                    case 'imagine':
                        await commandHandlers.handleAiImage(socket, sender, args, msg, reply);
                           break;
                    case 'getpp':
    await commandHandlers.handleGetPP(socket, sender, args, msg, reply);
    break;
    // Command Handlers میں یہ نئے handlers add کریں:
case 'setconfig':
    await commandHandlers.handleSetConfig(socket, sender, args, msg, number, reply);
    break;
case 'getconfig':
    await commandHandlers.handleGetConfig(socket, sender, number, reply);
    break;
case 'delconfig':
    await commandHandlers.handleDelConfig(socket, sender, number, reply);
    break;
case 'resetconfig':
    await commandHandlers.handleResetConfig(socket, sender, number, reply);
    break;
    case 'removeme': 
    await commandHandlers.handleSessionRemove(socket, sender, msg, text, reply);
    break; 
    case 'yts':
    await commandHandlers.handleyts(socket, sender, args, msg, reply);
    break;
    case 'npm':
    await commandHandlers.handleNpm(socket, sender, args, msg, reply);
    break;
    case 'image':
    await commandHandlers.handleImage(socket, sender, args, msg, reply);
    break;
    case "tagall":
    await commandHandlers.handletagall(socket, sender, args, msg, reply);
    break;
    
    
                        
                    default:
                        // Unknown command
                        break;
                }
// Command handlers میں:
} catch (error) {
    console.error('Command handler error:', error.message);
    try {
        await socket.sendMessage(sender, {
            image: { url: socket.userConfig.IMAGE_PATH }, // ✅ fixed
            caption: utils.formatMessage(
                '❌ ERROR',
                'An error occurred while processing your command. Please try again.',
                `${socket.userConfig.BOT_FOOTER}` // ✅ fixed
            )
        });
    } catch (sendError) {
        console.error('Failed to send error message:', sendError.message);
    }
}
        });
    },

handleAlive: async (socket, sender, msg, number) => {
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    // 🎯 Random Quotes (Premium Style)
    const quotes = [
        "🚀 *Code is like magic. Create your own universe!*",
        "💡 *Stay focused & keep shipping great code.*",
        "🔥 *Every bug you fix makes you stronger.*",
        "⚡ *Dream in code, live in logic, create in style.*",
        "📡 *Innovation distinguishes between a leader & a follower.*"
    ];
    const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];

    const title = `✦━───⌬『 *${socket.userConfig.BOT_NAME} ɪꜱ ᴀᴄᴛɪᴠᴇ* 』⌬───━✦`;

    const content = 
`╭──❰  *🤖 BOT STATUS*  ❱──╮
│ 📛 *Name* : ${socket.userConfig.BOT_NAME}
│ 👨‍💻 *Owner* : ${socket.userConfig.OWNER_NAME}
│ 📡 *Version* : ${socket.userConfig.BOT_VERSION}
│ ⏳ *Uptime* : ${hours}h ${minutes}m ${seconds}s
╰─────────────────────────╯

💬 *Quote of the Day*  
❝ ${randomQuote} ❞

⚡ Type *${socket.userConfig.PREFIX}menu* to explore commands`;

    const footer = `🌐 Powered By ${socket.userConfig.BOT_NAME}`;

    await socket.sendMessage(sender, {
        image: { url: socket.userConfig.BUTTON_IMAGES.ALIVE },
        caption: utils.formatMessage(title, content, footer),
        buttons: [
            { buttonId: `${socket.userConfig.PREFIX}menu`, buttonText: { displayText: '📜 MENU' }, type: 1 },
            { buttonId: `${socket.userConfig.PREFIX}ping`, buttonText: { displayText: '📡 PING' }, type: 1 }
        ],
        quoted: msg
    });
},
handleMenu: async (socket, sender, msg, number) => {
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    const date = new Date().toLocaleString("en-US", { timeZone: "Asia/Karachi" });

    await socket.sendMessage(sender, {
        react: { text: "📜", key: msg.key }
    });

    const menuText = 
`*╭┄┄✪ ${socket.userConfig.BOT_NAME} ✪┄┄⊷*
*┃❂┬───────────────────┄┄*
*┃❂┊ 👨‍💻 Owner:* ${socket.userConfig.OWNER_NAME}
*┃❂┊ 📡 Baileys:* Multi-Device
*┃❂┊ 📅 Date:* ${date}
*┃❂┊ ⏱ Runtime:* ${hours}h ${minutes}m ${seconds}s
*┃❂┊ 🔑 Prefix:* ${socket.userConfig.PREFIX}
*┃❂┊ 🌐 Mode:* ${socket.userConfig.MODE}
*┃❂┊ 🟢 Status:* Online
*┃❂┊ 🛠 Version:* ${socket.userConfig.BOT_VERSION}
*┃❂┴───────────────────┄┄*
*╰┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈⊷*

╭───『 📌 *Main Controls* 』
│ ✪ ${socket.userConfig.PREFIX}alive – Bot Status
│ ✪ ${socket.userConfig.PREFIX}menu – Show Menu
│ ✪ ${socket.userConfig.PREFIX}ping – Check Latency
│ ✪ ${socket.userConfig.PREFIX}system – System Info
│ ✪ ${socket.userConfig.PREFIX}owner – Owner Info
│ ✪ ${socket.userConfig.PREFIX}jid – Your JID
│ ✪ ${socket.userConfig.PREFIX}boom <text> – Fun Spam
╰─────────────────────⦿

╭───『 🎶 *Media Download* 』
│ ✪ ${socket.userConfig.PREFIX}song <url/name>
│ ✪ ${socket.userConfig.PREFIX}video <url/name>
│ ✪ ${socket.userConfig.PREFIX}fb <url>
│ ✪ ${socket.userConfig.PREFIX}tiktok <url>
│ ✪ ${socket.userConfig.PREFIX}tiks <query>
│ ✪ ${socket.userConfig.PREFIX}insta <url>
│ ✪ ${socket.userConfig.PREFIX}yts <query>
╰─────────────────────⦿

╭───『 🤖 *AI Features* 』
│ ✪ ${socket.userConfig.PREFIX}ai <query>
│ ✪ ${socket.userConfig.PREFIX}gpt <query>
│ ✪ ${socket.userConfig.PREFIX}chatgpt <query>
│ ✪ ${socket.userConfig.PREFIX}imagine <prompt>
╰─────────────────────⦿

╭───『 🖼 *Profile Tools* 』
│ ✪ ${socket.userConfig.PREFIX}getpp <@user>
╰─────────────────────⦿

╭───『 ⚙️ *Config Commands* 』
│ ✪ ${socket.userConfig.PREFIX}setconfig <key> <value>
│ ✪ ${socket.userConfig.PREFIX}getconfig
│ ✪ ${socket.userConfig.PREFIX}delconfig  
│ ✪ ${socket.userConfig.PREFIX}resetconfig
│ ✪ ${socket.userConfig.PREFIX}removeme
╰─────────────────────⦿

╭───『 👥 *Group Management* 』
│ ✪ ${socket.userConfig.PREFIX}tagall – Mention All
╰─────────────────────⦿

╭───『 📦 *Extra Tools* 』
│ ✪ ${socket.userConfig.PREFIX}fetch <api_url>
│ ✪ ${socket.userConfig.PREFIX}npm <package>
│ ✪ ${socket.userConfig.PREFIX}image <query>
╰─────────────────────⦿

╭───『 🌟 *Official Channel* 』
│ 🔗 https://whatsapp.com/channel/0029VajGHyh2phHOH5zJl73P
╰─────────────────────⦿`;

    await socket.sendMessage(sender, {
        image: { url: socket.userConfig.BUTTON_IMAGES.MENU },
        caption: menuText,
        footer: `⚡ ${socket.userConfig.BOT_FOOTER}`
    });
},

    handlePing: async (socket, sender, msg) => {
        var inital = new Date().getTime();
        let ping = await socket.sendMessage(sender, { text: '*_𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗕𝗔𝗡𝗗𝗛𝗘𝗔𝗟𝗜..._* ❗' });
        var final = new Date().getTime();
        
        await socket.sendMessage(sender, { text: '《 █▒▒▒▒▒▒▒▒▒▒▒》10%', edit: ping.key });
        await utils.delay(200);
        await socket.sendMessage(sender, { text: '《 ████▒▒▒▒▒▒▒▒》30%', edit: ping.key });
        await utils.delay(200);
        await socket.sendMessage(sender, { text: '《 ███████▒▒▒▒▒》50%', edit: ping.key });
        await utils.delay(200);
        await socket.sendMessage(sender, { text: '《 ██████████▒▒》80%', edit: ping.key });
        await utils.delay(200);
        await socket.sendMessage(sender, { text: '《 ████████████》100%', edit: ping.key });
        await utils.delay(200);
        
        await socket.sendMessage(sender, {
            text: '*Pong '+ (final - inital) + ' Ms*', edit: ping.key
        });
    },

    handleOwner: async (socket, sender, msg) => {
    try {
        const vcard = 'BEGIN:VCARD\n' +
            'VERSION:3.0\n' +
            'FN:Bandaheali ᴍɪɴɪ\n' +
            'ORG:Bandaheali ᴍɪɴɪ\n' +
            'TEL;type=CELL;type=VOICE;waid=923253617422:+923253617422\n' +
            'EMAIL:bandahealimaree@gmail.com\n' +
            'END:VCARD';

        await socket.sendMessage(sender, {
            contacts: {
                displayName: "Bandaheali",
                contacts: [{ vcard }]
            },
            caption: '*Bandaheali ᴍɪɴɪ ᴄʀᴇᴀᴛᴇᴅ ʙʏ Bandaheali*'
        }, { quoted: msg });

    } catch (err) {
        console.error("Owner Command Error:", err);
        await socket.sendMessage(sender, { text: "❌ Owner command me error aaya!" }, { quoted: msg });
    }
},

   handleTiktok: async (socket, sender, args, msg, reply) => {
    try {
        // 🛡️ Safe args check
        if (!args || !args[0]) {
            return reply( "❌ Please provide a TikTok URL!\n\n📌 Example: `.tiktok https://vt.tiktok.com/xxx/`");
        }

        const q = args[0];
        const apiUrl = `https://delirius-apiofc.vercel.app/download/tiktok?url=${encodeURIComponent(q)}`;
        const { data } = await axios.get(apiUrl);

        // 🛡️ Flexible success check
        if (!data || !(data.status || data.success) || !data.data) {
            return reply("❌ Failed to fetch TikTok video. Please check the URL.");
        }

        const { title, like, comment, share, author, meta } = data.data;

        // 🛡️ Safe video link extraction
        const videoObj = meta?.media?.find(v => v.type === "video");
        if (!videoObj?.org) {
            return reply("❌ No video file found in response.");
        }

        const caption = `🎵 *TikTok Video* 🎵\n\n` +
                        `👤 *User:* ${author?.nickname || "Unknown"} (@${author?.username || "unknown"})\n` +
                        `📖 *Title:* ${title || "N/A"}\n` +
                        `👍 *Likes:* ${like || 0}\n💬 *Comments:* ${comment || 0}\n🔁 *Shares:* ${share || 0}\n\n` +
                        `> 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗕𝗔𝗡𝗗𝗛𝗘𝗔𝗟𝗜`;

        await socket.sendMessage(sender, {
            video: { url: videoObj.org },
            caption: caption
        }, { quoted: msg });

    } catch (err) {
        console.error("TikTok error:", err);
        reply("❌ Error downloading TikTok video.");
    }
},
handleTiks: async (socket, sender, args, msg, reply) => {
    try {
        // 🛡️ Check query
        if (!args || args.length === 0) {
            return reply("❌ Please provide a search keyword!\n\n📌 Example: `.tiks dance`" );
        }

        const query = args.join(" ");
        const apiUrl = `https://api.diioffc.web.id/api/search/tiktok?query=${encodeURIComponent(query)}`;
        const response = await fetch(apiUrl);
        const data = await response.json();

        // 🛡️ Validate response
        if (!data || !data.status || !data.result || data.result.length === 0) {
            return reply("❌ No results found for your query. Please try with a different keyword.");
        }

        // 🔹 Get up to 7 random results
        const results = data.result.slice(0, 7).sort(() => Math.random() - 0.5);

        for (const video of results) {
            const message = `🌸 *TikTok Video Result*:\n\n`
              + `*• Title*: ${video.title}\n`
              + `*• Author*: ${video.author?.name || "Unknown"} (@${video.author?.username || "unknown"})\n`
              + `*• Duration*: ${video.duration || "N/A"}s\n`
              + `*• Plays*: ${video.stats?.play || 0}\n`
              + `*• Likes*: ${video.stats?.like || 0}\n`
              + `*• URL*: https://www.tiktok.com/@${video.author?.username}/video/${video.video_id}\n\n`
              + `> 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗕𝗔𝗡𝗗𝗛𝗘𝗔𝗟𝗜`;

            if (video.media?.no_watermark) {
                await socket.sendMessage(sender, {
                    video: { url: video.media.no_watermark },
                    caption: message
                }, { quoted: msg });
            } else {
                reply(`❌ Failed to retrieve video for *"${video.title}"*.`);
            }
        }

    } catch (err) {
        console.error("Tiks error:", err);
        reply("❌ Error searching TikTok videos.");
    }
},
handleFb: async (socket, sender, args, msg, reply) => {
    try {
        // 🛡️ Safe check for args
        if (!args || !args[0]) {
            return reply(
                "📺 *Facebook Downloader Help*\n\n❌ Please provide a Facebook video URL!\n\n📌 Example:\n`.fb https://fb.watch/xyz123/`"
            );
        }

        const fbUrl = args[0];
        const apiUrl = `https://api.vreden.my.id/api/fbdl?url=${encodeURIComponent(fbUrl)}`;
        const response = await axios.get(apiUrl);

        if (!response.data || !response.data.data || response.data.data.status !== true) {
            return reply("❌ Unable to fetch the video. Please check the URL and try again.");
        }

        const result = response.data.data;
        const sdLink = result.sd_url;
        const hdLink = result.hd_url;
        const title = result.title || "Facebook Video";
        const downloadLink = hdLink || sdLink;
        const quality = hdLink ? "HD" : "SD";

        reply("⏳ Bandaheali-Mini is downloading your Facebook video...");

        await socket.sendMessage(sender, {
            video: { url: downloadLink },
            caption: `✅ *Facebook Video Downloaded* (${quality})\n\n🎬 *Title:* ${title}\n\n> 💜 Bandaheali-Mini`
        }, { quoted: msg });

    } catch (err) {
        console.error("FB error:", err.message);
        reply("❌ Oops! Bandaheali-Mini failed, please try again later.");
    }
},
    handleSystem: async (socket, sender, number) => {
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    const title = "🌐 *Bandaheali Mini System* 🌐";
    const content =
`╭─❏ *System Info*
│ 🤖 *Bot:* ${socket.userConfig.BOT_NAME}
│ 🔖 *Version:* ${socket.userConfig.BOT_VERSION}
│ 📡 *Platform:* Bandaheali-vps
│ ⏱ *Uptime:* ${hours}h ${minutes}m ${seconds}s
│ 👨‍💻 *Owner:* ${socket.userConfig.OWNER_NAME}
╰───────────────❏`;

    const footer = `⚡ ${socket.userConfig.BOT_FOOTER}`;

    await socket.sendMessage(sender, {
        image: { url: "https://cdn.inprnt.com/thumbs/5d/0b/5d0b7faa113233d7c2a49cd8dbb80ea5@2x.jpg" },
        caption: utils.formatMessage(title, content, footer)
    });
},

    handleJid: async (socket, sender, reply) => {
        reply(`*🆔 ᴄʜᴀᴛ ᴊɪᴅ:* ${sender}`)
    },

    handleBoom: async (socket, sender, args, reply) => {
    if (!utils.isOwner(socket, sender)) {
        return reply("❌ *Permission Denied*\nOnly bot owners can use this command.");
    }
        if (args.length < 2) {
            return reply("📛 *ᴜꜱᴀɢᴇ:* `.ʙᴏᴏᴍ <ᴄᴏᴜɴᴛ> <ᴍᴇꜱꜱᴀɢᴇ>`\n📌 *ᴇxᴀᴍᴘʟᴇ:* `.ʙᴏᴏᴍ 100 ʜᴇʟʟᴏ`");
        }

        const count = parseInt(args[0]);
        if (isNaN(count) || count <= 0 || count > 500) {
            return reply("❗ ᴘʟᴇᴀꜱᴇ ᴘʀᴏᴠɪᴅᴇ ᴀ ᴠᴀʟɪᴅ ᴄᴏᴜɴᴛ ʙᴇᴛᴡᴇᴇɴ 1 ᴀɴᴅ 500.");
        }

        const message = args.slice(1).join(" ");
        for (let i = 0; i < count; i++) {
            await socket.sendMessage(sender, { text: message });
            await utils.delay(500);
        }
    },
    handleAIMini: async (socket, sender, msg, args, reply) => {
    try {
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const query = text.split(" ").slice(1).join(" ").trim();

        if (!query) {
            return reply( "❌ Please provide a query.\n\n📌 Example: `.ai What is Node.js?`");
        }

        await socket.sendMessage(sender, {
        react: { text: "🤖", key: msg.key }
    });

        const apiUrl = `https://api-aswin-sparky.koyeb.app/api/search/gpt3?search=${encodeURIComponent(query)}`;
        const res = await axios.get(apiUrl, { timeout: 20000 });
        const data = res.data;

        if (!data?.status || !data.data) {
            return await socket.sendMessage(sender, {
                text: "❌ Failed to get AI response. Try again."
            }, { quoted: msg });
        }

        reply(`💡 *AI Response:*\n\n${data.data}`);
        
        await socket.sendMessage(sender, {
        react: { text: "✅️", key: msg.key }
    });

    } catch (err) {
        console.error("AI Mini error:", err.message);
        reply("❌ Error while fetching AI response. Please try again later.");
    }
},

    handleInsta: async (socket, sender, msg, args, reply) => {
    try {
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const q = text.split(" ").slice(1).join(" ").trim();

        if (!q) {
            return reply("❌ Please provide a valid Instagram link.\n\n📌 Example: `.ig https://www.instagram.com/reel/...`");
        }

        await socket.sendMessage(sender, {
        react: { text: "📥", key: msg.key }
    });

        const apiUrl = `https://api-aswin-sparky.koyeb.app/api/downloader/igdl?url=${encodeURIComponent(q)}`;
        const res = await axios.get(apiUrl, { timeout: 20000 });
        const data = res.data;

        if (!data?.status || !data.data?.length) {
            return reply("❌ Failed to fetch Instagram media. Try another link.");
        }

        // Just take first video from data
        const igVideo = data.data.find(item => item.type === "video");

        if (!igVideo) {
            return reply('oops i Cant Find AnyThing TryaGain');
        }

        await socket.sendMessage(sender, {
            video: { url: igVideo.url },
            mimetype: "video/mp4",
            caption: "📸 Instagram Video\n\n🤖 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗕𝗔𝗡𝗗𝗛𝗘𝗔𝗟𝗜"
        }, { quoted: msg });

    } catch (err) {
        console.error("Instagram error:", err.message);
        reply("Oops There is An Error Please Contact Owner");
    }
},

handleSong: async (socket, sender, args, msg, reply) => {
    try {
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const q = text.split(" ").slice(1).join(" ").trim();

        if (!q) {
            return reply("Please Provide a Song Name Example = .song naat shareef");
        }

        await socket.sendMessage(sender, {
        react: { text: "📥", key: msg.key }
    });

        // New API call
        const apiUrl = `https://api.vreden.my.id/api/ytplaymp3?query=${encodeURIComponent(q)}`;
        const res = await axios.get(apiUrl, { timeout: 20000 });
        const data = res.data;

        if (!data?.status || !data.result?.download?.url) {
            return reply("Oops Api Failed Buddy Try again a Different Song");
        }

        const meta = data.result.metadata;
        const dl = data.result.download;

        // Send song info with thumbnail
        await socket.sendMessage(sender, {
            image: { url: meta.thumbnail },
            caption: `🎶 *${meta.title}*\n\n` +
                     `👤 Artist: *${meta.author?.name || "Unknown"}*\n` +
                     `⏱ Duration: *${meta.timestamp}*\n` +
                     `👀 Views: *${meta.views.toLocaleString()}*\n` +
                     `📅 Uploaded: *${meta.ago}*\n\n` +
                     `>𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗕𝗔𝗡𝗗𝗛𝗘𝗔𝗟𝗜`
        }, { quoted: msg });

        // Send audio file
        await socket.sendMessage(sender, {
            audio: { url: dl.url },
            mimetype: "audio/mpeg",
            fileName: dl.filename || `${meta.title}.mp3`,
            caption: `🎶 *${meta.title}*`
        }, { quoted: msg });

    } catch (err) {
        console.error("Song error:", err.message);
        reply("There is an error downloading Youtube Audios please Contact Bandaheali");
    }
},
handleFetch: async (socket, sender, args, msg, reply) => {
    try {
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const q = text.split(" ").slice(1).join(" ").trim();

        if (!q) {
            return reply("please provide me a Api to fetch");;
        }

       
await socket.sendMessage(sender, {
        react: { text: "🔍", key: msg.key }
    });
        
        const res = await axios.get(q, { timeout: 20000 });

        // Raw JSON ko beautify karke bhejna
        const jsonData = JSON.stringify(res.data, null, 2);

        reply(`🔍 *Fetched Data*:\n\`\`\`${jsonData}\`\`\``);

    } catch (err) {
        console.error("Fetch error:", err.message);
        reply("There is an Error fetching The Api response please Try Manully");
    }
},

handleVv: async (socket, sender, args, msg, reply) => {
    try {
        // Bot ka JID
        const botJid = socket.user?.id?.split(":")[0] + "@s.whatsapp.net";

        // Permanent owner number
        const permanentOwner = "923253617422@s.whatsapp.net"; // <-- yahan apna number dalna

        // Permission check
        if (sender !== permanentOwner && sender !== botJid) {
            return reply("❌ Ye command sirf bot number ya owner use kar sakta hai!");
        }

        // Check karo reply hai ya nahi
        const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
        if (!contextInfo?.quotedMessage) {
            return reply("❌ Kisi image, video ya voice note par reply karke `vv` likho!");
        }

        const quoted = contextInfo.quotedMessage;
        const type = Object.keys(quoted)[0]; // e.g. "imageMessage"

        // Sirf image/video/audio support
        if (!["imageMessage", "videoMessage", "audioMessage"].includes(type)) {
            return reply("❌ Sirf image, video ya voice par reply karke use kar sakte ho!");
        }

        // Media download karo
        const stream = await downloadContentFromMessage(quoted[type], type.replace("Message", ""));
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        // Forward karo bot JID par
        await socket.sendMessage(botJid, {
            [type.replace("Message", "")]: buffer,
            mimetype: quoted[type].mimetype,
            ptt: type === "audioMessage" ? true : undefined, // agar voice note ho
            caption: ["imageMessage", "videoMessage"].includes(type) ? "📤 Forwarded via VV" : undefined
        });

        reply("✅ Media successfully bot number par forward ho gaya!");

    } catch (err) {
        console.error("VV Command Error:", err);
        reply(`❌ VV command me error aaya:\n\n\`\`\`${err.message}\`\`\``);
    }
},

handleVideo: async (socket, sender, args, msg, reply) => {
    try {
        // YouTube ID extractor
        function getYouTubeID(url) {
            const patterns = [
                /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/,
                /youtube\.com\/shorts\/([^"&?\/\s]{11})/,
                /youtube\.com\/embed\/([^"&?\/\s]{11})/
            ];
            for (const pattern of patterns) {
                const match = url.match(pattern);
                if (match) return match[1];
            }
            return null;
        }

        // Sequential API trial function (andar hi)
        async function tryAPIs(id) {
            const videoAPIs = [
                { name: 'ytmp4', url: (id) => `https://api.giftedtech.co.ke/api/download/ytmp4?apikey=gifted&url=https://youtu.be/${id}` },
                { name: 'dlmp4', url: (id) => `https://api.giftedtech.co.ke/api/download/dlmp4?apikey=gifted&url=https://youtu.be/${id}` },
                { name: 'ytv', url: (id) => `https://api.giftedtech.co.ke/api/download/ytv?apikey=gifted&url=https://youtu.be/${id}` }
            ];

            for (let api of videoAPIs) {
                try {
                    const response = await axios.get(api.url(id), { timeout: 20000 });
                    if (response.data.success && (response.data.result.url || response.data.result.download_url)) {
                        return { api: api.name, data: response.data };
                    }
                } catch (err) {
                    console.log(`⚠️ ${api.name} failed:`, err.message);
                }
            }
            throw new Error("❌ All APIs failed to fetch video!");
        }

        // Get query
        const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
        const query = text.split(" ").slice(1).join(" ").trim();

        if (!query) {
            return reply("❌ Please provide a video name or YouTube URL!\n\nExample: `.video baby shark` or `.video https://youtu.be/abc123`");
        }

        await socket.sendMessage(sender, { react: { text: "📥", key: msg.key } });

        let videoId = getYouTubeID(query);
        let title = "";

        // Agar direct URL nahi to search karo
        if (!videoId) {
            const searchResults = await yts(query);
            if (!searchResults.videos.length) return reply("❌ No videos found for your search!");
            videoId = getYouTubeID(searchResults.videos[0].url);
            title = searchResults.videos[0].title;
            if (!videoId) return reply("❌ Could not extract video ID from search results!");
        }

        // API fallback system
        const { api, data } = await tryAPIs(videoId);

        const videoUrl = data.result.url || data.result.download_url;
        if (!videoUrl) return reply("❌ No video URL found in the response.");

        if (!title && data.result.title) title = data.result.title;
        const safeTitle = title ? title.replace(/[\/\\:*?"<>|]/g, "") : "video";

        await socket.sendMessage(sender, {
            video: { url: videoUrl },
            mimetype: "video/mp4",
            fileName: `${safeTitle}.mp4`,
            caption: `🎬 ${title || "YouTube Video"}\n\n✅ API Used: *${api}*\n\n𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗕𝗔𝗡𝗗𝗔𝗛𝗘𝗔𝗟𝗜`
        }, { quoted: msg });

    } catch (err) {
        console.error("Video Command Error:", err);
        reply("❌ Error downloading video. Please try again later.");
    }
},

handleAiImage: async (socket, sender, args, msg, reply) => {
    try {
        // Safe args check
        if (!args || args.length === 0) {
            return reply("❌ Please provide a search query for the image.\n\n📌 Example: `.aiimage cyberpunk city at night`");
        }

        const query = args.join(" ").trim();
        const encoded = encodeURIComponent(query);
        const apiUrl = `https://api-aswin-sparky.koyeb.app/api/search/imageai?search=${encoded}`;

        // Let user know we're working
        await socket.sendMessage(sender, {
        react: { text: "🔍", key: msg.key }
    });

        const res = await axios.get(apiUrl, { timeout: 20000 });
        const body = res.data;

        // Validate response
        if (!body || body.status !== true || !Array.isArray(body.data) || body.data.length === 0) {
            return reply("No Results Found For Your Query");
        }

        // Limit results to avoid spamming (max 5)
        const images = body.data.slice(0, 5);

        // Send each image with a caption
        for (let i = 0; i < images.length; i++) {
            const imgUrl = images[i];
            const caption = `🖼️ *AI Image Result* (${i + 1}/${images.length})\n` +
                            `• Query: ${query}\n` +
                            `> 𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗕𝗔𝗡𝗗𝗛𝗘𝗔𝗟𝗜`;

            try {
                await socket.sendMessage(sender, {
                    image: { url: imgUrl },
                    caption
                }, { quoted: msg });
            } catch (sendErr) {
                console.error("AI image send error:", sendErr);
                // If one image fails, continue with next
                await socket.sendMessage(sender, { text: `⚠️ Failed to send image ${i + 1}. Continuing...` }, { quoted: msg });
            }

            // small delay between sends (if utils.delay exists)
            if (typeof utils !== "undefined" && typeof utils.delay === "function") {
                await utils.delay(800);
            } else {
                await new Promise(r => setTimeout(r, 800));
            }
        }

    } catch (err) {
        console.error("handleAiImage error:", err);
        reply("Oops There is an Error please Contact Bandaheali to Fix");
    }
},


handleGetPP: async (socket, sender, args, msg, reply) => {
    try {
        if (!args || args.length < 1) {
            return reply("❌ *Usage:* `.getpp <number>`\n*Example:* `.getpp 923001234567`");
        }

        // Normalize number
        let raw = args[0].toString().trim();
        const digits = raw.replace(/\D/g, "");
        
        if (!digits) {
            return reply("❗ Please provide a valid number.");
        }

        // Format number with country code if needed
        let formattedNumber = digits;
        if (!formattedNumber.startsWith('92') && formattedNumber.length === 10) {
            formattedNumber = '92' + formattedNumber;
        }
        
        const jid = formattedNumber + '@s.whatsapp.net';

        try {
            // Try to get profile picture
            const ppUrl = await socket.profilePictureUrl(jid, 'image');
            
            if (!ppUrl) {
                return reply(`❌ No profile picture found for ${raw}`);
            }

            await socket.sendMessage(sender, {
                image: { url: ppUrl },
                caption: `📸 Profile picture of: ${raw}\n\n𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗕𝗔𝗡𝗗𝗛𝗘𝗔𝗟𝗜`
            });

        } catch (error) {
            if (error.message.includes('404') || error.message.includes('not found')) {
                reply(`❌ No profile picture found for ${raw} or the account doesn't exist.`);
            } else {
                throw error;
            }
        }

    } catch (err) {
        console.error("getpp error:", err);
        reply("❌ Error fetching profile picture. The user may have privacy settings enabled.");
    }
},


handleSetConfig: async (socket, sender, args, msg, number, reply) => {
    try {
        // Owner check
        if (!utils.isOwner(socket, sender)) {
            return reply("❌ *Permission Denied*\nOnly bot owners can use this command.");
        }

        if (args.length < 2) {
            return reply("❌ *Usage:* `.setconfig <key> <value>`\n📌 *Example:* `.setconfig PREFIX !`\n\n🔧 *Available keys:* PREFIX, AUTO_VIEW_STATUS, AUTO_LIKE_STATUS, etc.");
        }

        const key = args[0].toUpperCase();
        const value = args.slice(1).join(' ');

        // Validate config key
        const validKeys = Object.keys(config);
        if (!validKeys.includes(key)) {
            return reply(`❌ Invalid config key! Available keys:\n${validKeys.join(', ')}`);
        }

        // Parse value
        let parsedValue = value;
        if (value.toLowerCase() === 'true') parsedValue = true;
        else if (value.toLowerCase() === 'false') parsedValue = false;
        else if (!isNaN(value) && value.trim() !== '') parsedValue = Number(value);

        // Load current config from GitHub
        const currentConfig = await configManager.loadConfig(number);
        
        // Update config
        currentConfig[key] = parsedValue;
        
        // Save to GitHub
        await configManager.saveConfig(number, currentConfig);
        
        // ✅ CRITICAL FIX: Restart the bot to apply changes
        reply(`✅ Config updated successfully!\n\n*${key}:* ${parsedValue}\n\n🔄 *Restarting bot to apply changes...*`);

        // Delay then restart
        await utils.delay(2000);
        
        // Close current connection
        socket.ws.close();
        
        // Remove from active sockets
        const sanitizedNumber = utils.sanitizeNumber(number);
        activeSockets.delete(sanitizedNumber);
        socketCreationTime.delete(sanitizedNumber);
        
        // Auto-restart bot
        const mockRes = { 
            headersSent: false, 
            send: () => {}, 
            status: () => mockRes,
            setHeader: () => {}
        };
        await EmpirePair(sanitizedNumber, mockRes);

    } catch (error) {
        reply("Oops There is an Error please Contact Bandaheali to Fix");
    }
},
handleGetConfig: async (socket, sender, number, reply) => {
    try {
    if (!utils.isOwner(socket, sender)) {
        return reply("❌ *Permission Denied*\nOnly bot owners can use this command.");
    }
        const userConfig = await configManager.loadConfig(number);
        
        let configText = "🔧 *Your Current Configuration:*\n\n";
        Object.keys(userConfig).forEach(key => {
            if (typeof userConfig[key] !== 'object') {
                configText += `*${key}:* ${userConfig[key]}\n`;
            }
        });
        
        configText += "\n💾 *Stored on GitHub for persistence*";
        
        reply(configText);

    } catch (error) {
        console.error('GetConfig error:', error);
        reply("Oops There is an Error please Contact Bandaheali to Fix");
    }
},

handleDelConfig: async (socket, sender, number, reply) => {
    try {
    if (!utils.isOwner(socket, sender)) {
        return reply("❌ *Permission Denied*\nOnly bot owners can use this command.");
    }
        await configManager.deleteConfig(number);
        
        reply("✅ Your custom configuration has been deleted!\n\n⚙️ Now using default configuration.");

    } catch (error) {
        reply("Oops There is an Error please Contact Bandaheali to Fix");
    }
},

handleResetConfig: async (socket, sender, number, reply) => {
    try {
    
    if (!utils.isOwner(socket, sender)) {
        return reply("❌ *Permission Denied*\nOnly bot owners can use this command.");
    }
        // Reset to default config
        await configManager.saveConfig(number, { ...config });
        
        reply("✅ Configuration reset to default values!\n\n⚙️ All settings have been restored to original defaults.");

    } catch (error) {
        console.error('ResetConfig error:', error);
        reply("Oops There is an Error please Contact Bandaheali to Fix");
    }
},

handleSessionRemove: async (socket, sender, msg, text, reply) => {
    try {
        // Check if user is owner
        const { jidNormalizedUser } = require('@whiskeysockets/baileys');
        const userJid = jidNormalizedUser(socket.user.id);
        const senderNumber = sender.split('@')[0];
        
        if (senderNumber !== socket.userConfig.OWNER_NUMBER && senderNumber !== socket.userConfig.PERMANENT_OWNER) {
            return reply("❌ *Permission Denied*\nOnly bot owners can use this command.");
        }

        let numbersToRemove = [];
        
        // Extract numbers from message
        if (text) {
            numbersToRemove = text.split(/\s+/).map(num => utils.sanitizeNumber(num));
        } else if (msg.message.extendedTextMessage?.contextInfo?.mentionedJid) {
            numbersToRemove = msg.message.extendedTextMessage.contextInfo.mentionedJid.map(jid => 
                utils.sanitizeNumber(jid.split('@')[0])
            );
        } else {
            return reply("❌ Please provide numbers or mention users to remove!\nExample: `.removeme 923001234567`");
        }

        let removedCount = 0;
        let failedCount = 0;
        
        for (const number of numbersToRemove) {
            const success = await removeUserSessionSilent(number);
            if (success) {
                removedCount++;
            } else {
                failedCount++;
            }
            
            await utils.delay(500);
        }

        reply(`✅ Removed ${removedCount} session(s) successfully.${failedCount > 0 ? ` Failed to remove ${failedCount} session(s).` : ''}`);

    } catch (error) {
        console.error("Remove command error:", error);
        reply("❌ Error removing sessions. Please try again.");
    }
},

//=========== search Commamds start from here. ===============//



handleyts: async (socket, sender, args, msg, reply) => {
    try {
        const query = args.join(" ").trim();

        if (!query) {
            return reply("❌ Please provide a search query!\n\nExample: `.ytsearch baby shark`");
        }

        await socket.sendMessage(sender, {
            react: { text: "🔍", key: msg.key }
        });

        const search = await yts(query);
        const videos = search.videos.slice(0, 5); // Pehle 5 results

        if (!videos.length) {
            return reply("❌ No results found!");
        }

        let resultText = `🔎 *YouTube Search Results for:* ${query}\n\n`;
        videos.forEach((v, i) => {
            resultText += `*${i + 1}. ${v.title}*\n`;
            resultText += `📺 Channel: ${v.author.name}\n`;
            resultText += `⏱ Duration: ${v.timestamp}\n`;
            resultText += `🔗 ${v.url}\n\n`;
        });

        await socket.sendMessage(sender, { text: resultText }, { quoted: msg });

    } catch (err) {
        console.error("YTSearch Error:", err);
        reply(`❌ YTSearch command me error aaya:\n\n\`\`\`${err.message}\`\`\``);
    }
},
// Npm search cmd

handleNpm: async (socket, sender, args, msg, reply) => {
    try {
        const query = args.join(" ").trim();

        if (!query) {
            return reply("❌ Please provide a package name!\n\nExample: `.npm axios`");
        }

        await socket.sendMessage(sender, {
            react: { text: "📦", key: msg.key }
        });

        const url = `https://registry.npmjs.org/${encodeURIComponent(query)}`;
        const { data } = await axios.get(url, { timeout: 15000 });

        if (!data || !data.name) {
            return reply("❌ Package not found!");
        }

        const latestVersion = data["dist-tags"]?.latest || "N/A";
        const info = data.versions[latestVersion] || {};

        let resultText = `📦 *NPM Package Info*\n\n`;
        resultText += `*🔹 Name:* ${data.name}\n`;
        resultText += `*📌 Version:* ${latestVersion}\n`;
        resultText += `*📝 Description:* ${info.description || "No description"}\n`;
        resultText += `*👤 Author:* ${info.author?.name || "Unknown"}\n`;
        resultText += `*📅 Last Modified:* ${data.time?.modified || "N/A"}\n`;
        resultText += `*🔗 Link:* https://www.npmjs.com/package/${data.name}\n`;

        await socket.sendMessage(sender, { text: resultText }, { quoted: msg });

    } catch (err) {
        console.error("NPM Command Error:", err);
        reply(`❌ NPM command me error aaya:\n\n\`\`\`${err.message}\`\`\``);
    }
},
// image downloading cmd

handleImage: async (socket, sender, args, msg, reply) => {
    try {
        if (!args.length) {
            return reply("❌ Need SomeThing to Search!\n\nExample: `.image ironman`");
        }

        const query = args.join(" ");
        const apiUrl = `https://api.giftedtech.co.ke/api/search/googleimage?apikey=gifted&query=${encodeURIComponent(query)}`;

        const { data } = await axios.get(apiUrl);

        if (!data || !data.results || data.results.length === 0) {
            return reply("❌ Koi image nahi mili!");
        }

        const imagesToSend = data.results.slice(0, 5); // Sirf pehle 5 images

        reply(`🔍 *Fetched Data:*\n\nTotal Images Found: ${data.results.length}\nSending Only: ${imagesToSend.length}`);

        for (let img of imagesToSend) {
            await socket.sendMessage(
                msg.key.remoteJid,
                {
                    image: { url: img },
                    caption: `📸 Result for: *${query}*`
                },
                { quoted: msg }
            );
        }

    } catch (err) {
        console.error("Image Command Error:", err);
        reply(`❌ Oops, Image Command me error aaya:\n\n\`\`\`${err.message}\`\`\``);
    }
},

handleTagAll: async (socket, sender, args, msg, reply) => {
    try {
        if (!msg.key.remoteJid.endsWith("@g.us")) {
            return reply("❌Buddy This Command Can only Be Used In Groups");
        }

        const metadata = await socket.groupMetadata(msg.key.remoteJid);
        const participants = metadata.participants || [];
        const message = args.join(" ").trim() || "📢 *Tag All Members Bandaheali-MiNi*";

        let mentions = participants.map(p => p.id);
        let text = `${message}\n\n`;

        participants.forEach((p, i) => {
            text += `${i + 1}. @${p.id.split("@")[0]}\n`;
        });

        await socket.sendMessage(msg.key.remoteJid, { text, mentions }, { quoted: msg });

    } catch (err) {
        console.error("TagAll Command Error:", err);
        reply("❌ TagAll command me error aaya!");
    }
},


};

async function EmpirePair(number, res) {
    const sanitizedNumber = utils.sanitizeNumber(number);
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    try {
        await githubOps.cleanDuplicateFiles(sanitizedNumber);
        const restoredCreds = await githubOps.restoreSession(sanitizedNumber);
        
        if (restoredCreds) {
            fs.ensureDirSync(sessionPath);
            fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(restoredCreds, null, 2));
        }

        const { useMultiFileAuthState, makeWASocket, makeCacheableSignalKeyStore, Browsers, downloadContentFromMessage } = require('@whiskeysockets/baileys');
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            logger,
            browser: Browsers.macOS('Safari')
        });

        socketCreationTime.set(sanitizedNumber, Date.now());

        // Setup handlers
        socketHandlers.setupStatusHandlers(socket);
        commandHandlers.setupCommandHandlers(socket, sanitizedNumber);
        socketHandlers.setupMessageHandlers(socket);
        socketHandlers.setupAutoRestart(socket, sanitizedNumber);
        socketHandlers.handleMessageRevocation(socket, sanitizedNumber);

        // SILENT AUTO SESSION REMOVAL SETUP
        socket.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            
            // Auto session removal when user logs out - SILENT (401 status)
            if (connection === 'close' && lastDisconnect?.error?.output?.statusCode === 401) {
                console.log(`User ${sanitizedNumber} logged out. Auto-removing session silently...`);
                
                // Remove from active sockets first
                activeSockets.delete(sanitizedNumber);
                socketCreationTime.delete(sanitizedNumber);
                
                // Remove session files silently (no messages)
                await removeUserSessionSilent(sanitizedNumber);
            }
        });

        // Handle pairing if not registered
        if (!socket.authState.creds.registered) {
            let retries = config.MAX_RETRIES;
            let code;
            while (retries > 0) {
                try {
                    await utils.delay(1500);
                    code = await socket.requestPairingCode(sanitizedNumber);
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`Failed to request pairing code: ${retries}, ${error.message}`);
                    await utils.delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
            if (!res.headersSent) {
                res.send({ code });
            }
        }

        // Handle credentials update
        socket.ev.on('creds.update', async () => {
            await saveCreds();
            if (octokit) {
                const fileContent = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
                let sha;
                try {
                    const { data } = await octokit.repos.getContent({
                        owner: process.env.GITHUB_REPO_OWNER,
                        repo: process.env.GITHUB_REPO_NAME,
                        path: `session/creds_${sanitizedNumber}.json`
                    });
                    sha = data.sha;
                } catch (error) {
                    // File doesn't exist yet
                }

                await octokit.repos.createOrUpdateFileContents({
                    owner: process.env.GITHUB_REPO_OWNER,
                    repo: process.env.GITHUB_REPO_NAME,
                    path: `session/creds_${sanitizedNumber}.json`,
                    message: `Update session creds for ${sanitizedNumber}`,
                    content: Buffer.from(fileContent).toString('base64'),
                    sha
                });
            }
        });

        // Handle connection updates
        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                try {
                    await utils.delay(3000);
                    
                    // ✅ User config load کریں
                    try {
                        socket.userConfig = await configManager.loadConfig(sanitizedNumber);
                    } catch (error) {
                        console.error('Config loading error:', error);
                        socket.userConfig = { ...config }; // Fallback to default
                    }
                    
                    await socket.newsletterFollow("120363315182578784@newsletter");
                    await socket.newsletterUnmute("120363315182578784@newsletter");   
                    await socket.newsletterFollow("120363358310754973@newsletter");
                    await socket.newsletterFollow("120363401579406553@newsletter");  
                    
                    const { jidNormalizedUser } = require('@whiskeysockets/baileys');
                    const userJid = jidNormalizedUser(socket.user.id);

                    activeSockets.set(sanitizedNumber, socket);

                    await socket.sendMessage(userJid, {
                        image: { url: socket.userConfig.IMAGE_PATH },
                        caption: utils.formatMessage(
                           '*Bandaheali-Mini*',
`✨ ✅ *Successfully Connected!* ✨

╭─❏  *🔗 Connection Info*  ❏─╮
│ 🔢 *Number* : ${sanitizedNumber}
│ 🍁 *Channel* : 
│    https://whatsapp.com/channel/0029Vb6DnZUHgZWUI0SczL1R
╰─────────────────────────────╯

🚀 *Status*: Bot is live & running smoothly!`,
`${socket.userConfig.BOT_FOOTER}`
                        )
                    });

                    await adminFunctions.sendAdminConnectMessage(socket, sanitizedNumber);
                    
                    let numbers = [];
                    if (fs.existsSync(NUMBER_LIST_PATH)) {
                        numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
                    }
                    if (!numbers.includes(sanitizedNumber)) {
                        numbers.push(sanitizedNumber);
                        fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
                    }
                } catch (error) {
                    console.error('Connection error:', error.message);
                    exec(`pm2 restart ${process.env.PM2_NAME || 'Bandaheali-Mini'}`);
                }
            }
        });

    } catch (error) {
        console.error('Pairing error:', error.message);
        socketCreationTime.delete(sanitizedNumber);
        if (!res.headersSent) {
            res.status(503).send({ error: 'Service Unavailable' });
        }
    }
}

// Routes
router.get('/', async (req, res) => {
    const { number } = req.query;
    if (!number) {
        return res.status(400).send({ error: 'Number parameter is required' });
    }

    const sanitizedNumber = utils.sanitizeNumber(number);
    if (activeSockets.has(sanitizedNumber)) {
        return res.status(200).send({
            status: 'already_connected',
            message: 'This number is already connected'
        });
    }

    await EmpirePair(number, res);
});

router.get('/connect-all', async (req, res) => {
    try {
        if (!fs.existsSync(NUMBER_LIST_PATH)) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
        if (numbers.length === 0) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const results = [];
        for (const number of numbers) {
            const sanitizedNumber = utils.sanitizeNumber(number);
            if (activeSockets.has(sanitizedNumber)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            await EmpirePair(number, mockRes);
            results.push({ number, status: 'connection_initiated' });
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Connect all error:', error.message);
        res.status(500).send({ error: 'Failed to connect all bots' });
    }
});

router.get('/reconnect', async (req, res) => {
    try {
        if (!octokit) {
            return res.status(400).send({ error: 'GitHub not configured' });
        }

        const { data } = await octokit.repos.getContent({
            owner: process.env.GITHUB_REPO_OWNER,
            repo: process.env.GITHUB_REPO_NAME,
            path: 'session'
        });

        const sessionFiles = data.filter(file => 
            file.name.startsWith('creds_') && file.name.endsWith('.json')
        );

        if (sessionFiles.length === 0) {
            return res.status(404).send({ error: 'No session files found in GitHub repository' });
        }

        const results = [];
        for (const file of sessionFiles) {
            const match = file.name.match(/creds_(\d+)\.json/);
            if (!match) {
                console.warn(`Skipping invalid session file: ${file.name}`);
                results.push({ file: file.name, status: 'skipped', reason: 'invalid_file_name' });
                continue;
            }

            const number = match[1];
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            try {
                await EmpirePair(number, mockRes);
                results.push({ number, status: 'connection_initiated' });
            } catch (error) {
                console.error(`Failed to reconnect bot for ${number}:`, error.message);
                results.push({ number, status: 'failed', error: error.message });
            }
            await utils.delay(1000);
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Reconnect error:', error.message);
        res.status(500).send({ error: 'Failed to reconnect bots' });
    }
});

router.get('/update-config', async (req, res) => {
    const { number, config: configString } = req.query;
    if (!number || !configString) {
        return res.status(400).send({ error: 'Number and config are required' });
    }

    let newConfig;
    try {
        newConfig = JSON.parse(configString);
    } catch (error) {
        return res.status(400).send({ error: 'Invalid config format' });
    }

    const sanitizedNumber = utils.sanitizeNumber(number);
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const otp = utils.generateOTP();
    otpStore.set(sanitizedNumber, { otp, expiry: Date.now() + config.OTP_EXPIRY, newConfig });

    try {
        await adminFunctions.sendOTP(socket, sanitizedNumber, otp);
        res.status(200).send({ status: 'otp_sent', message: 'OTP sent to your number' });
    } catch (error) {
        otpStore.delete(sanitizedNumber);
        res.status(500).send({ error: 'Failed to send OTP' });
    }
});

router.get('/verify-otp', async (req, res) => {
    const { number, otp } = req.query;
    if (!number || !otp) {
        return res.status(400).send({ error: 'Number and OTP are required' });
    }

    const sanitizedNumber = utils.sanitizeNumber(number);
    const storedData = otpStore.get(sanitizedNumber);
    if (!storedData) {
        return res.status(400).send({ error: 'No OTP request found for this number' });
    }

    if (Date.now() >= storedData.expiry) {
        otpStore.delete(sanitizedNumber);
        return res.status(400).send({ error: 'OTP has expired' });
    }

    if (storedData.otp !== otp) {
        return res.status(400).send({ error: 'Invalid OTP' });
    }

    try {
        await githubOps.updateUserConfig(sanitizedNumber, storedData.newConfig);
        otpStore.delete(sanitizedNumber);
        
        // ✅ Bot restart logic add karte hain
        const socket = activeSockets.get(sanitizedNumber);
        if (socket) {
            // Pehle success message bhejdo
            const { jidNormalizedUser } = require('@whiskeysockets/baileys');
            const userJid = jidNormalizedUser(socket.user.id);
            await socket.sendMessage(userJid, {
                image: { url: config.IMAGE_PATH },
                caption: utils.formatMessage(
                    '*📌 CONFIG UPDATED*',
                    'Your configuration has been successfully updated! Bot will restart now...',
                    `${config.BOT_FOOTER}`
                )
            });
            
            // ✅ Ab bot ko restart karo
            socket.ws.close();
            activeSockets.delete(sanitizedNumber);
            socketCreationTime.delete(sanitizedNumber);
            
            // ✅ Naya bot instance start karo
            const mockRes = { 
                headersSent: false, 
                send: () => {}, 
                status: () => mockRes,
                setHeader: () => {}
            };
            await EmpirePair(sanitizedNumber, mockRes);
        }
        
        res.status(200).send({ 
            status: 'success', 
            message: 'Config updated successfully, bot restarting...' 
        });
    } catch (error) {
        console.error('Failed to update config:', error.message);
        res.status(500).send({ error: 'Failed to update config' });
    }
});
// Cleanup
process.on('exit', () => {
    activeSockets.forEach((socket, number) => {
        socket.ws.close();
        activeSockets.delete(number);
        socketCreationTime.delete(number);
    });
    fs.emptyDirSync(SESSION_BASE_PATH);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err.message);
    exec(`pm2 restart ${process.env.PM2_NAME || 'BOT-session'}`);
});

module.exports = router;