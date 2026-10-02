const http = require('http');
const https = require('https');
const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./database');
const binance = require('./binance');

// 1. Immediately start HTTP server for Render / Cloud health check
const PORT = process.env.PORT || 10000;
const httpServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
        status: 'ok', 
        bot: 'AI Marketplace Telegram Bot', 
        time: new Date().toISOString() 
    }));
});
const HOST = process.env.IP || '0.0.0.0';
httpServer.listen(PORT, HOST, () => {
    console.log(`🌐 Keep-alive HTTP server listening on ${HOST}:${PORT}`);
});

// 2. Keep-Alive Self-Ping (Prevents Render Free Tier from sleeping after 15-30 minutes)
const pingTargetUrl = process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;
if (pingTargetUrl) {
    console.log(`📡 Keep-Alive auto-pinger enabled for: ${pingTargetUrl}`);
    setInterval(() => {
        try {
            const client = pingTargetUrl.startsWith('https') ? https : http;
            client.get(pingTargetUrl, (res) => {
                console.log(`⏰ [Keep-Alive] Ping sent to ${pingTargetUrl} (Status: ${res.statusCode})`);
            }).on('error', (err) => {
                console.warn('Keep-alive ping warning:', err.message);
            });
        } catch (e) {
            console.warn('Keep-alive exception:', e.message);
        }
    }, 7 * 60 * 1000); // Ping every 7 minutes (Render sleeps after 15-30 minutes)
}

// Initialize database
db.initDb();

const bot = new Telegraf(config.BOT_TOKEN);

// In-memory state tracking for user conversations
const userStates = new Map();

// Admin ID holder (can be dynamically claimed or loaded from config)
let currentAdminId = config.ADMIN_ID;

// Helper: Check if caller is Owner (@Giooo12be) or configured Admin
function isOwner(ctx) {
    if (!ctx || !ctx.from) return false;
    const username = (ctx.from.username || '').toLowerCase().replace('@', '');
    const isGio = username === 'giooo12be' || String(ctx.from.id) === '5670174407';
    if (isGio && ctx.from.id) {
        currentAdminId = ctx.from.id; // Automatically bind owner's Telegram ID!
    }
    const isAdminId = currentAdminId && String(ctx.from.id) === String(currentAdminId);
    return isGio || isAdminId;
}

// Helper: Main Bottom Keyboard (English, clean, high aesthetic)
function getMainKeyboard(ctx) {
    if (ctx && isOwner(ctx)) {
        return Markup.keyboard([
            ['🛒 Marketplace', '💰 Wallet'],
            ['📦 My Orders', '💬 Owner Support'],
            ['👑 Owner Admin Panel']
        ]).resize();
    }
    return Markup.keyboard([
        ['🛒 Marketplace', '💰 Wallet'],
        ['📦 My Orders', '💬 Owner Support']
    ]).resize();
}

// Middleware: register user in DB & recognize Owner
bot.use(async (ctx, next) => {
    if (ctx.from) {
        db.getOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
        const uname = (ctx.from.username || '').toLowerCase().replace('@', '');
        if (uname === 'giooo12be') {
            currentAdminId = ctx.from.id;
        }
    }
    return next();
});

// /start command
bot.command('start', async (ctx) => {
    const user = db.getUser(ctx.from.id);
    const balance = user ? user.balance.toFixed(2) : '0.00';
    const name = ctx.from.first_name || 'Member';

    const welcomeText = 
`💎 **WELCOME TO AI MARKETPLACE** 💎
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👋 Hello, **${name}**! 

Welcome to the #1 premium digital store for AI tools, subscriptions, and digital upgrades. All accounts come with **100% Full Warranty** and instant automatic delivery!

💰 **Your Wallet Balance:** \`$${balance}\`
🆔 **Your Account ID:** \`${ctx.from.id}\`
🏷️ **Your Payment Memo:** \`#TG${ctx.from.id}\`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👇 *Select an option from the menu below to get started:*`;

    const animPath = path.resolve(__dirname, '..', 'assets', 'chatgpt_welcome.mp4');
    const bannerPath = path.resolve(__dirname, '..', 'assets', 'banner.jpg');
    const CHATGPT_ANIMATION_ID = 'CgACAgIAAxkDAAICzWq4AoScVUzqP7vgEd_o27HbnuMGAALepAACabnBSYeFPd-MsDBcPQQ';

    try {
        await ctx.replyWithAnimation(CHATGPT_ANIMATION_ID, {
            caption: welcomeText,
            parse_mode: 'Markdown',
            ...getMainKeyboard(ctx)
        });
    } catch (animErr) {
        if (fs.existsSync(animPath)) {
            await ctx.replyWithAnimation(
                { source: animPath },
                { caption: welcomeText, parse_mode: 'Markdown', ...getMainKeyboard(ctx) }
            ).catch(async () => {
                if (fs.existsSync(bannerPath)) {
                    await ctx.replyWithPhoto(
                        { source: bannerPath },
                        { caption: welcomeText, parse_mode: 'Markdown', ...getMainKeyboard(ctx) }
                    ).catch(async () => {
                        await ctx.replyWithMarkdown(welcomeText, getMainKeyboard(ctx)).catch(() => {});
                    });
                } else {
                    await ctx.replyWithMarkdown(welcomeText, getMainKeyboard(ctx)).catch(() => {});
                }
            });
        } else if (fs.existsSync(bannerPath)) {
            await ctx.replyWithPhoto(
                { source: bannerPath },
                { caption: welcomeText, parse_mode: 'Markdown', ...getMainKeyboard(ctx) }
            ).catch(async () => {
                await ctx.replyWithMarkdown(welcomeText, getMainKeyboard(ctx)).catch(() => {});
            });
        } else {
            await ctx.replyWithMarkdown(welcomeText, getMainKeyboard(ctx)).catch(() => {});
        }
    }
});

// /id or /myid command
bot.command(['id', 'myid', 'whoami'], async (ctx) => {
    const isUserOwner = isOwner(ctx);
    const text = 
`🆔 **TELEGRAM IDENTITY INFO**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 **Name:** ${ctx.from.first_name || ''} ${ctx.from.last_name || ''}
🏷️ **Username:** ${ctx.from.username ? '@' + ctx.from.username : 'No username set'}
🔢 **Telegram User ID:** \`${ctx.from.id}\`
👑 **Role:** ${isUserOwner ? '👑 Owner / Administrator' : '👤 Customer'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 *Tip: Click on the ID number above to copy it.*`;

    await ctx.replyWithMarkdown(text);
});


// /claimadmin command (Quickly register the owner as Admin)
bot.command('claimadmin', async (ctx) => {
    currentAdminId = ctx.from.id;
    
    // Save to .env if possible
    try {
        const envPath = path.resolve(__dirname, '..', '.env');
        let envContent = fs.readFileSync(envPath, 'utf-8');
        if (envContent.includes('ADMIN_ID=')) {
            envContent = envContent.replace(/ADMIN_ID=.*/, `ADMIN_ID=${ctx.from.id}`);
        } else {
            envContent += `\nADMIN_ID=${ctx.from.id}\n`;
        }
        fs.writeFileSync(envPath, envContent, 'utf-8');
    } catch (e) {}

    await ctx.replyWithMarkdown(
`👑 **ADMIN PRIVILEGES ACTIVATED!**

You are now the recognized Administrator!
• **Admin ID:** \`${ctx.from.id}\`
• You will receive instant Telegram notifications whenever a user requests a Binance deposit or makes a purchase.
• Type \`/admin\` anytime to manage deposits and view sales analytics.`
    );
});

// Marketplace View
async function showMarketplace(ctx) {
    if (ctx.callbackQuery) {
        await ctx.answerCbQuery('⚡ Loading Marketplace...').catch(() => {});
        await ctx.editMessageText('🔄 *Loading Marketplace...*\n`[ ▰▰▰▰▱▱▱▱▱▱ ] 45%` ⚡', { parse_mode: 'Markdown' }).catch(() => {});
        await new Promise((r) => setTimeout(r, 160));
    } else {
        await ctx.sendChatAction('typing').catch(() => {});
    }

    const products = db.getProducts();
    const user = db.getUser(ctx.from.id);
    const balance = user ? user.balance.toFixed(3) : '0.000';

    if (products.length === 0) {
        return ctx.reply('⚠️ Marketplace is currently restocking. Check back in a few minutes!');
    }

    let text = 
`🛍️ **AI MARKETPLACE ✦ STORE**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 **Wallet Balance:** \`$${balance}\` 🟢
⚡ **Server Status:** \`🟢 Online & Instant Auto-Delivery\`

✦ **Available Subscriptions:**
*Tap any product below to view details and order:*`;

    const buttons = products.map((p) => {
        const stock = db.getAvailableStockCount(p.id);
        const stockBadge = stock > 0 ? `🟢 (${stock} in stock)` : '🔴 (Out of stock)';
        return [
            Markup.button.callback(`${p.name} ✦ $${p.price.toFixed(3)} ${stockBadge}`, `prod_${p.id}`)
        ];
    });

    buttons.push([
        Markup.button.callback('💳 Top Up Balance (Binance Pay)', 'deposit_binance')
    ]);

    const keyboard = Markup.inlineKeyboard(buttons);

    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard }).catch(async () => {
            await ctx.replyWithMarkdown(text, keyboard);
        });
    } else {
        await ctx.replyWithMarkdown(text, keyboard);
    }
}

bot.hears('🛒 Marketplace', showMarketplace);
bot.action('menu_marketplace', showMarketplace);

// Product Details Screen
bot.action(/^prod_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery('✨ Loading Product Details...').catch(() => {});
    await ctx.editMessageText('⚡ *Loading Product Details...*\n`[ ▰▰▰▰▰▰▰▱▱▱ ] 70%` 🧠', { parse_mode: 'Markdown' }).catch(() => {});
    await new Promise((r) => setTimeout(r, 160));

    const productId = parseInt(ctx.match[1], 10);
    const product = db.getProductById(productId);

    if (!product) {
        return ctx.reply('❌ Product not found or expired.');
    }

    const user = db.getUser(ctx.from.id);
    const balance = user ? user.balance : 0;
    const stockCount = db.getAvailableStockCount(product.id);
    const stockBadge = stockCount > 0 ? `🟢 In Stock (${stockCount} available)` : '🔴 Out of Stock (Restocking soon)';

    let text = 
`${product.name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💵 **Price:** \`$${product.price.toFixed(3)}\`
🛡️ **Warranty:** ${product.warranty || 'Full 30-Day Guarantee'}
⚡ **Stock:** ${stockBadge}

${product.description}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💳 **Your Current Balance:** \`$${balance.toFixed(3)}\` 🟢`;

    if (stockCount === 0) {
        text += `\n⚠️ *This product is currently out of stock. Owner Support @Giooo12be will restock shortly!*`;
    } else if (balance < product.price) {
        const diff = (product.price - balance).toFixed(3);
        text += `\n⚠️ *Shortfall:* \`$${diff}\` *(Deposit required)*`;
    } else {
        text += `\n✅ *Sufficient balance ready to purchase!*`;
    }

    const keyboardButtons = [];
    keyboardButtons.push([Markup.button.callback('🛍️ Purchase / Select Quantity (1–5)', `select_qty_${product.id}`)]);
    keyboardButtons.push([Markup.button.callback('💳 Top Up Balance (Binance)', 'deposit_binance')]);
    keyboardButtons.push([Markup.button.callback('🔙 Back to Marketplace', 'menu_marketplace')]);

    const keyboard = Markup.inlineKeyboard(keyboardButtons);

    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard }).catch(async () => {
        await ctx.replyWithMarkdown(text, keyboard);
    });
});

// Quantity Picker Screen (1 to 5 accounts)
async function showQuantityPicker(ctx, productId) {
    const product = db.getProductById(productId);
    if (!product) return ctx.reply('❌ Product not found.');

    const user = db.getUser(ctx.from.id);
    const balance = user ? user.balance : 0;
    const stockCount = db.getAvailableStockCount(product.id);
    const stockBadge = stockCount > 0 ? `🟢 **${stockCount} In Stock**` : `🔴 **Out of Stock (Restocking)**`;

    const text = 
`🛍️ **SELECT QUANTITY (1 — 5 ACCOUNTS)**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 Product: **${product.name}**
💵 Unit Price: \`$${product.price.toFixed(2)}\`
⚡ Stock: ${stockBadge}
💳 Your Balance: \`$${balance.toFixed(2)}\` 🟢

👇 *Choose how many accounts you want to purchase:*`;

    const keyboardButtons = [
        [
            Markup.button.callback(`1️⃣ 1x ($${(product.price * 1).toFixed(2)})`, `order_qty_${product.id}_1`),
            Markup.button.callback(`2️⃣ 2x ($${(product.price * 2).toFixed(2)})`, `order_qty_${product.id}_2`),
            Markup.button.callback(`3️⃣ 3x ($${(product.price * 3).toFixed(2)})`, `order_qty_${product.id}_3`)
        ],
        [
            Markup.button.callback(`4️⃣ 4x ($${(product.price * 4).toFixed(2)})`, `order_qty_${product.id}_4`),
            Markup.button.callback(`5️⃣ 5x ($${(product.price * 5).toFixed(2)})`, `order_qty_${product.id}_5`)
        ],
        [
            Markup.button.callback('💳 Top Up Balance (Binance)', 'deposit_binance'),
            Markup.button.callback('🔙 Back to Product', `prod_${product.id}`)
        ]
    ];

    const keyboard = Markup.inlineKeyboard(keyboardButtons);
    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard }).catch(async () => {
            await ctx.replyWithMarkdown(text, keyboard);
        });
    } else {
        await ctx.replyWithMarkdown(text, keyboard);
    }
}

bot.action(/^select_qty_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await showQuantityPicker(ctx, parseInt(ctx.match[1], 10));
});

bot.action(/^buy_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await showQuantityPicker(ctx, parseInt(ctx.match[1], 10));
});

// Quantity Selected -> Check & Confirm Screen
bot.action(/^order_qty_(\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = parseInt(ctx.match[1], 10);
    const qty = parseInt(ctx.match[2], 10);
    const product = db.getProductById(productId);
    if (!product) return ctx.reply('❌ Product not found.');

    const user = db.getUser(ctx.from.id);
    const balance = user ? user.balance : 0;
    const stockCount = db.getAvailableStockCount(product.id);
    const totalCost = product.price * qty;

    // 1. Stock Check
    if (stockCount === 0) {
        if (currentAdminId && !isOwner(ctx)) {
            const buyerUser = ctx.from.username ? `@${ctx.from.username}` : 'No username';
            bot.telegram.sendMessage(
                currentAdminId,
                `⚠️ **OUT OF STOCK ALERT!**\nUser \`${buyerUser}\` (ID: \`${user.id}\`) attempted to buy ${qty}x **${product.name}**, but stock is empty!\nPlease add accounts via 👑 Owner Admin Panel.`,
                { parse_mode: 'Markdown' }
            ).catch(() => {});
        }
        return ctx.editMessageText(
`⚠️ **OUT OF STOCK**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
We are currently restocking **${product.name}**.
Owner Support @Giooo12be has been notified to add new accounts.

Please contact @Giooo12be directly or check back shortly!`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.url('💬 Contact Owner Support (@Giooo12be)', 'https://t.me/Giooo12be')],
                    [Markup.button.callback('🔙 Change Quantity', `select_qty_${product.id}`)],
                    [Markup.button.callback('🛒 Back to Marketplace', 'menu_marketplace')]
                ])
            }
        ).catch(async () => {});
    }

    if (stockCount < qty) {
        return ctx.editMessageText(
`⚠️ **LIMITED INVENTORY AVAILABLE**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 Product: **${product.name}**
❌ Requested: **${qty} Accounts**
🟢 Available In Stock: **${stockCount} Account(s)**

Please select up to **${stockCount}** accounts or message Owner Support @Giooo12be.`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback(`🛍️ Buy Max Available (${stockCount}x)`, `order_qty_${product.id}_${stockCount}`)],
                    [Markup.button.callback('🔙 Choose Another Quantity', `select_qty_${product.id}`)],
                    [Markup.button.url('💬 Message Owner Support', 'https://t.me/Giooo12be')]
                ])
            }
        ).catch(async () => {});
    }

    // 2. Balance Check
    if (balance < totalCost) {
        const diff = (totalCost - balance).toFixed(2);
        return ctx.editMessageText(
`❌ **INSUFFICIENT WALLET BALANCE**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 Product: **${product.name}**
🔢 Quantity: **${qty} Account(s)**
💰 Total Cost: \`$${totalCost.toFixed(2)}\`
💳 Current Balance: \`$${balance.toFixed(2)}\`
⚠️ Shortfall: \`$${diff}\`

Please top up your wallet using **Binance Pay** to complete this order:`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('💳 Top Up Balance (Binance)', 'deposit_binance')],
                    [Markup.button.callback('🔙 Change Quantity', `select_qty_${product.id}`)],
                    [Markup.button.callback('🔙 Return to Product', `prod_${product.id}`)]
                ])
            }
        ).catch(async () => {});
    }

    // 3. Confirmation Screen
    const remainingBalance = (balance - totalCost).toFixed(2);
    const confirmText = 
`🛒 **CONFIRM PURCHASE ORDER**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 Product: **${product.name}**
🔢 Quantity: **${qty} Account(s)**
💵 Unit Price: \`$${product.price.toFixed(3)}\`
💰 Total Price: \`$${totalCost.toFixed(2)}\`
🛡️ Warranty: **${product.warranty || 'Full Warranty'}**

💳 Current Balance: \`$${balance.toFixed(2)}\`
💳 Balance After Purchase: \`$${remainingBalance}\` 🟢

⚡ *Click Confirm below to receive your account credentials instantly!*`;

    return ctx.editMessageText(confirmText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback(`✅ Confirm & Pay $${totalCost.toFixed(2)}`, `exec_buy_${product.id}_${qty}`)],
            [Markup.button.callback('🔙 Change Quantity', `select_qty_${product.id}`)],
            [Markup.button.callback('❌ Cancel', `prod_${product.id}`)]
        ])
    }).catch(async () => {});
});

// Final Order Execution (Dispense & Deliver)
bot.action(/^exec_buy_(\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery('⚡ Processing and delivering your order...').catch(() => {});
    const productId = parseInt(ctx.match[1], 10);
    const qty = parseInt(ctx.match[2], 10);
    const product = db.getProductById(productId);
    if (!product) return ctx.reply('❌ Product not found.');

    const user = db.getUser(ctx.from.id);
    const totalCost = product.price * qty;

    // Safety checks
    const stockCount = db.getAvailableStockCount(product.id);
    if (stockCount < qty) {
        return ctx.reply(`⚠️ Inventory update: only ${stockCount} account(s) available now. Please choose quantity again.`);
    }

    if (user.balance < totalCost) {
        return ctx.reply('❌ Insufficient balance. Please top up your wallet.');
    }

    // Deduct balance
    db.updateBalance(user.id, -totalCost);

    // Create Order in DB
    const orderTitle = qty > 1 ? `${product.name} (x${qty})` : product.name;
    const orderId = db.createOrder(
        user.id,
        product.id,
        orderTitle,
        totalCost,
        ''
    );

    // Dispense real stock accounts
    const dispensedAccounts = db.dispenseMultipleStockAccounts(product.id, qty, orderId);

    let deliveryContent = '';
    if (dispensedAccounts && dispensedAccounts.length > 0) {
        if (dispensedAccounts.length === 1) {
            deliveryContent = dispensedAccounts[0].account_content;
        } else {
            deliveryContent = dispensedAccounts.map((acc, index) => 
                `🔑 **Account #${index + 1}:**\n${acc.account_content}`
            ).join('\n\n━━━━━━━━━━━━━━━━━━\n\n');
        }
    } else {
        deliveryContent = 'Account credentials will be sent directly by Owner Support @Giooo12be.';
    }

    db.updateOrderDelivery(orderId, deliveryContent);

    const now = new Date();
    const orderDate = now.toISOString().replace('T', ' ').substring(0, 16);
    const orderRef = `ORD-TG${user.id}-${Math.floor(Date.now() / 1000)}`;
    const warrantyText = product.warranty || '🛡️ Full Warranty';

    const successText = 
`📦 **Shop Order Delivery**
===================
**Product:** ${product.name}
**Quantity:** ${qty}
**Order ID:** \`${orderRef}\`
**Order Date:** ${orderDate}
**Unit Price:** $${product.price.toFixed(3)}
**Total Cost:** $${totalCost.toFixed(3)}
**Warranty:** ${warrantyText}

**Account Details:**
---------------
${deliveryContent}

**Product Details & Guidelines:**
---------------------------------
📌 **${product.name} — Guidelines & Warranty**

━━━━━━━━━━━━━━━━━━
1️⃣ **MANDATORY SCREEN RECORDING**
📹 Please start screen recording BEFORE your first login attempt.
The recording must clearly show:
• Entering the provided email & password
• Opening the 2FA Link to get the OTP code
• The login attempt and any error encountered
❌ *No replacement or claim is accepted without valid video proof.*

━━━━━━━━━━━━━━━━━━
2️⃣ **IMMEDIATE ACTIONS AFTER LOGIN**
🔐 After successfully logging in:
• Change account password
• Update 2FA / Authenticator details
• Set your own recovery email if applicable

━━━━━━━━━━━━━━━━━━
3️⃣ **WARRANTY CONDITIONS**
🛡️ **${warrantyText}:**
• Full replacement warranty covers unexpected access loss during normal use.
• For assistance, message @Giooo12be with your Order ID and recording.

━━━━━━━━━━━━━━━━━━
✅ *Thank you for purchasing from AI Marketplace!*`;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.url('💬 Contact Owner Support (@Giooo12be)', 'https://t.me/Giooo12be')],
        [Markup.button.callback('📦 View My Orders', 'menu_orders')],
        [Markup.button.callback('🛒 Back to Marketplace', 'menu_marketplace')]
    ]);

    await ctx.editMessageText(successText, { parse_mode: 'Markdown', ...keyboard }).catch(async () => {
        await ctx.replyWithMarkdown(successText, keyboard);
    });

    // Alert Admin
    if (currentAdminId) {
        const remainingStock = db.getAvailableStockCount(product.id);
        const buyerUser = ctx.from.username ? `@${ctx.from.username}` : 'No username';
        const adminMsg = 
`🔔 **NEW SALE COMPLETED!**
🧾 Order: #ORD-${orderId}
👤 Buyer: \`${buyerUser}\` (ID: \`${ctx.from.id}\`)
📦 Product: **${product.name}**
🔢 Quantity: **${qty} Account(s)**
💰 Revenue: \`$${totalCost.toFixed(2)}\`
📦 Remaining Stock: **${remainingStock}**`;
        bot.telegram.sendMessage(currentAdminId, adminMsg, { parse_mode: 'Markdown' }).catch(() => {});
    }
});

// Helper: Generate Payment Invoice Text
function generateInvoiceText(userId, amount = 5.50) {
    return `💳 Payment
──────────────
💳 Method: Binance Pay
💵 Send exactly: \`${amount.toFixed(3)} USDT\`

⚠️ Proof is required. Sending money is not enough.

📌 Binance ID / Pay ID
\`${config.BINANCE_PAY_ID}\`

Open Binance → Pay → Pay with Binance ID, send the exact amount.

✍️ Then paste your Binance Pay Order ID here.
Find it: Binance app → Pay / Transaction history → open the payment → copy Order ID.

🌐 Status: ⏳ Pending
Paste your Order ID here. Wait 5–10 seconds after paste.`;
}

// Deposit Screen (Binance Pay)
async function showDepositScreen(ctx, amount = 5.50) {
    if (ctx.callbackQuery) {
        await ctx.answerCbQuery('🟡 Opening Binance Pay Gateway...').catch(() => {});
        await ctx.editMessageText('🟡 *Connecting to Binance Pay...*\n`[ ▰▰▰▰▰▱▱▱▱▱ ] 50%` ⚡', { parse_mode: 'Markdown' }).catch(() => {});
        await new Promise((r) => setTimeout(r, 160));
    } else {
        await ctx.sendChatAction('typing').catch(() => {});
    }

    const userId = ctx.from.id;
    // Set user state to listen for Order ID
    userStates.set(userId, { step: 'awaiting_txid', invoiceAmount: amount });

    const text = generateInvoiceText(userId, amount);

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📌 Copy Pay ID', 'copy_pay_id')],
        [Markup.button.callback('🔄 Check payment', 'check_payment_btn')],
        [Markup.button.callback('🔙 Back to Menu', 'menu_marketplace')]
    ]);

    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard }).catch(async () => {
            await ctx.replyWithMarkdown(text, keyboard);
        });
    } else {
        await ctx.replyWithMarkdown(text, keyboard);
    }
}

bot.hears(['💳 Deposit (Binance)', '💳 Top Up Balance', /Deposit/i], (ctx) => showDepositScreen(ctx, 5.50));
bot.action('deposit_binance', (ctx) => showDepositScreen(ctx, 5.50));

// Copy Pay ID Button handler
bot.action('copy_pay_id', async (ctx) => {
    await ctx.answerCbQuery(`Pay ID: ${config.BINANCE_PAY_ID}`, { show_alert: true });
    await ctx.reply(`\`${config.BINANCE_PAY_ID}\`\n\n*(Tap the number above to copy it)*`, { parse_mode: 'Markdown' });
});

// Check payment Button handler
bot.action('check_payment_btn', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.replyWithMarkdown(
`✍️ **Please paste your Binance Pay Order ID below in the chat.**
*(Find it: Binance app → Pay → Transaction history → tap transaction → copy Order ID)*

Wait 5–10 seconds after pasting.`
    );
});

// Submit TXID Step
bot.action('submit_txid', async (ctx) => {
    await ctx.answerCbQuery();
    userStates.set(ctx.from.id, { step: 'awaiting_txid' });

    const text = 
`📥 **SUBMIT BINANCE PAYMENT PROOF**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Please reply with your **Binance Order ID / Transaction ID** and the amount paid (or upload payment screenshot).

📌 **Example format:**
\`5.50$ Order ID: 294819284719283741\`

❌ Tap below to cancel:`;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancel', 'cancel_action')]
    ]);

    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard }).catch(async () => {
        await ctx.replyWithMarkdown(text, keyboard);
    });
});

bot.action('cancel_action', async (ctx) => {
    await ctx.answerCbQuery();
    userStates.delete(ctx.from.id);
    await ctx.editMessageText('Action cancelled.', Markup.inlineKeyboard([
        [Markup.button.callback('🛒 Return to Marketplace', 'menu_marketplace')]
    ])).catch(() => {});
});

// Helper: Generate Wallet Screen Text matching user template
function buildWalletText(userId) {
    const user = db.getUser(userId);
    const balance = user ? user.balance : 0.00;
    const customerId = (userId % 0xFFFFFF).toString(16).toUpperCase().padStart(6, '0');
    const deposits = db.getUserDeposits(userId);

    let text = `💰 Wallet\n──────────────\nBalance: $${balance.toFixed(3)} 🟢\nCustomer ID: #CX-${customerId}\n\n`;
    text += `📌 Tap Add funds to top up your balance.\n`;
    text += `✅ Accepted: 🟡 Binance Pay (Instant ⚡)\n\n`;

    text += `📊 Recent activity\n`;
    const approved = deposits.filter((d) => d.status === 'approved');
    if (approved.length > 0) {
        const lastDep = approved[0];
        text += `• 🟢 Added: $${lastDep.amount.toFixed(3)} · Binance Pay Order #${lastDep.tx_id}\n\n`;
    } else {
        text += `• No recent deposit activity.\n\n`;
    }

    text += `🧾 Recent payments\n`;
    if (approved.length > 0) {
        approved.slice(0, 3).forEach((dep) => {
            const dateStr = new Date(dep.created_at || Date.now()).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
            });
            text += `• ⚡ ${dateStr} · Binance Pay · Credited\n`;
        });
    } else {
        text += `• No recent payments.\n`;
    }

    return text;
}

// Wallet / Profile Screen
async function showWallet(ctx) {
    if (ctx.callbackQuery) {
        await ctx.answerCbQuery('💰 Fetching Wallet Ledger...').catch(() => {});
        await ctx.editMessageText('🔄 *Syncing Wallet Balance...*\n`[ ▰▰▰▰▰▰▰▰▱▱ ] 80%` 🟢', { parse_mode: 'Markdown' }).catch(() => {});
        await new Promise((r) => setTimeout(r, 160));
    } else {
        await ctx.sendChatAction('typing').catch(() => {});
    }

    const text = buildWalletText(ctx.from.id);

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('➕ Add funds', 'deposit_binance')],
        [Markup.button.callback('🛒 Marketplace', 'menu_marketplace')],
        [Markup.button.callback('📦 My Orders', 'menu_orders')]
    ]);

    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard }).catch(async () => {
            await ctx.replyWithMarkdown(text, keyboard);
        });
    } else {
        await ctx.replyWithMarkdown(text, keyboard);
    }
}

bot.hears('💰 Wallet', showWallet);
bot.hears('👤 My Profile', showWallet);
bot.action('menu_profile', showWallet);
bot.action('menu_wallet', showWallet);

// My Orders Screen
async function showOrders(ctx) {
    if (ctx.callbackQuery) {
        await ctx.answerCbQuery('📦 Loading Your Purchases...').catch(() => {});
        await ctx.editMessageText('📦 *Loading Purchase Vault...*\n`[ ▰▰▰▰▰▰▱▱▱▱ ] 60%` ⚡', { parse_mode: 'Markdown' }).catch(() => {});
        await new Promise((r) => setTimeout(r, 160));
    } else {
        await ctx.sendChatAction('typing').catch(() => {});
    }

    const orders = db.getUserOrders(ctx.from.id);

    if (orders.length === 0) {
        const emptyText = 
`📦 **YOU HAVE NO ORDERS YET**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Visit the Marketplace to explore our subscriptions and digital upgrades!`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('🛒 Browse Marketplace', 'menu_marketplace')]
        ]);
        if (ctx.callbackQuery) {
            return ctx.editMessageText(emptyText, { parse_mode: 'Markdown', ...keyboard }).catch(async () => {
                await ctx.replyWithMarkdown(emptyText, keyboard);
            });
        }
        return ctx.replyWithMarkdown(emptyText, keyboard);
    }

    let text = 
`📦 **YOUR PURCHASE HISTORY (${orders.length} Orders)**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    orders.slice(0, 10).forEach((order) => {
        text += `🔹 **Order #ORD-${order.id} | ${order.product_name}**\n`;
        text += `💰 Paid: \`$${order.price.toFixed(2)}\` | 📅 ${order.created_at}\n`;
        text += `🔑 **Delivered Details:**\n\`\`\`\n${order.delivery_content}\n\`\`\`\n\n`;
    });

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🛒 Back to Marketplace', 'menu_marketplace')]
    ]);

    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard }).catch(async () => {
            await ctx.replyWithMarkdown(text, keyboard);
        });
    } else {
        await ctx.replyWithMarkdown(text, keyboard);
    }
}

bot.hears('📦 My Orders', showOrders);
bot.action('menu_orders', showOrders);

// Support & FAQ
async function showSupport(ctx) {
    if (ctx.callbackQuery) {
        await ctx.answerCbQuery('💬 Connecting to Owner Support...').catch(() => {});
        await ctx.editMessageText('💬 *Connecting to Support Service...*\n`[ ▰▰▰▰▰▰▰▰▱▱ ] 85%` ⚡', { parse_mode: 'Markdown' }).catch(() => {});
        await new Promise((r) => setTimeout(r, 160));
    } else {
        await ctx.sendChatAction('typing').catch(() => {});
    }

    const text = 
`💬 **OWNER & CUSTOMER SUPPORT**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👋 Need assistance with your order, Binance payment, or warranty replacement?

Our Owner Support is available to help you directly on Telegram!

👤 **Owner Support:** @Giooo12be
🛡️ **Warranty Guarantee:** 100% Full 30-Day Replacement Guarantee on all subscriptions.

Tap the button below to message Owner Support directly:`;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.url('💬 Message @Giooo12be', 'https://t.me/Giooo12be')],
        [Markup.button.callback('🛒 Browse Marketplace', 'menu_marketplace')]
    ]);

    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard }).catch(async () => {
            await ctx.replyWithMarkdown(text, keyboard);
        });
    } else {
        await ctx.replyWithMarkdown(text, keyboard);
    }
}

bot.hears('💬 Owner Support', showSupport);
bot.hears('ℹ️ Support & FAQ', showSupport);
bot.action('menu_support', showSupport);

// Owner Admin Dashboard (/admin & button)
async function showAdminDashboard(ctx) {
    try {
        if (!isOwner(ctx)) {
            return ctx.reply('⛔ Access denied: This dashboard is reserved exclusively for Owner @Giooo12be.');
        }

        const stats = db.getUserStats();
        const pendingDeposits = db.getPendingDeposits();
        const products = db.getProducts();

        let stockSummary = '';
        for (const p of products) {
            const count = db.getAvailableStockCount(p.id);
            const icon = count > 0 ? '🟢' : '🔴';
            stockSummary += `• ${p.name}: ${icon} **${count} in stock**\n`;
        }

        const text = 
`👑 **OWNER ADMINISTRATOR DASHBOARD**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 **Owner Account:** @Giooo12be
🆔 **Owner ID:** \`${ctx.from.id}\`

📊 **Sales & System Analytics:**
• 👥 Registered Users: \`${stats.totalUsers}\`
• 📦 Orders Fulfilled: \`${stats.totalOrders}\`
• 💰 Sales Volume: \`$${stats.totalVolume.toFixed(2)}\`
• 💳 Approved Deposits: \`$${stats.totalDeposits.toFixed(2)}\`
• ⏳ Pending Deposits: \`${pendingDeposits.length}\`

📦 **Real Inventory Stock:**
${stockSummary}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👇 *Select an admin tool below:*`;

        const keyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback('➕ Add Stock: ChatGPT Plus', 'admin_add_stock_plus'),
                Markup.button.callback('➕ Add Stock: GPT K-12', 'admin_add_stock_teacher')
            ],
            [
                Markup.button.callback('📋 View Available Stock', 'admin_view_stock'),
                Markup.button.callback(`⏳ Pending Deposits (${pendingDeposits.length})`, 'admin_pending_deps')
            ],
            [
                Markup.button.callback('👥 Users List', 'admin_list_users'),
                Markup.button.callback('💳 Add Balance', 'admin_prompt_addbalance')
            ],
            [
                Markup.button.callback('📢 Broadcast Message', 'admin_prompt_broadcast')
            ],
            [
                Markup.button.callback('💾 Backup SQL & DB', 'admin_backup_db'),
                Markup.button.callback('📥 Restore SQL / DB', 'admin_prompt_restore_db')
            ]
        ]);

        if (ctx.callbackQuery) {
            await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard }).catch(async () => {
                await ctx.replyWithMarkdown(text, keyboard);
            });
        } else {
            await ctx.replyWithMarkdown(text, keyboard);
        }
    } catch (err) {
        console.error('Error in showAdminDashboard:', err);
        await ctx.reply(`⚠️ Admin Dashboard Error: ${err.message}`);
    }
}

bot.hears(['👑 Owner Admin Panel', /^(👑 Owner Admin Panel|\/?admin)$/i], showAdminDashboard);
bot.command('admin', showAdminDashboard);
bot.action('admin_main_dashboard', showAdminDashboard);

// Admin Action: Add Stock ChatGPT Plus
bot.action('admin_add_stock_plus', async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCbQuery('⛔ Access denied.');
    await ctx.answerCbQuery();
    const products = db.getProducts();
    const plusProd = products.find(p => p.name.includes('ChatGPT Plus')) || products[0];

    userStates.set(ctx.from.id, { step: 'admin_adding_stock', productId: plusProd.id, productName: plusProd.name });

    const text = 
`➕ **ADD ACCOUNT STOCK**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 Product: **${plusProd.name}**

Please send the account credentials you want to add.

📌 **Format example:**
\`\`\`
📧 Email: example_user@outlook.com
🔑 Password: Password123!
🔗 2FA Link: https://2fa.tgdatahub.site/BCIJCJFJC25QFQNOONHK2RBB6HUSCLOJ
\`\`\`

*(💡 Tip: You can paste multiple accounts at once separated by \`---\` on a new line!)*

Type \`/cancel\` to abort.`;

    await ctx.replyWithMarkdown(text);
});

// Admin Action: Add Stock GPT K-12 Teacher
bot.action('admin_add_stock_teacher', async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCbQuery('⛔ Access denied.');
    await ctx.answerCbQuery();
    const products = db.getProducts();
    const teacherProd = products.find(p => p.name.includes('Teacher')) || products[1] || products[0];

    userStates.set(ctx.from.id, { step: 'admin_adding_stock', productId: teacherProd.id, productName: teacherProd.name });

    const text = 
`➕ **ADD ACCOUNT STOCK**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 Product: **${teacherProd.name}**

Please send the account credentials you want to add.

📌 **Format example:**
\`\`\`
📧 Email: teacher_k12@outlook.com
🔑 Password: TeacherPass2026!
🔗 2FA Link: https://2fa.tgdatahub.site/BCIJCJFJC25QFQNOONHK2RBB6HUSCLOJ
\`\`\`

*(💡 Tip: You can paste multiple accounts at once separated by \`---\` on a new line!)*

Type \`/cancel\` to abort.`;

    await ctx.replyWithMarkdown(text);
});

// Admin Action: View Available Stock
bot.action('admin_view_stock', async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCbQuery('⛔ Access denied.');
    await ctx.answerCbQuery();

    const stock = db.getAllAvailableStock();
    if (stock.length === 0) {
        return ctx.replyWithMarkdown(
`📦 **INVENTORY STOCK EMPTY**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
There are currently 0 accounts in stock.

Use the buttons below to add accounts:`,
            Markup.inlineKeyboard([
                [Markup.button.callback('➕ Add Stock: ChatGPT Plus', 'admin_add_stock_plus')],
                [Markup.button.callback('➕ Add Stock: GPT K-12', 'admin_add_stock_teacher')],
                [Markup.button.callback('👑 Back to Dashboard', 'admin_main_dashboard')]
            ])
        );
    }

    let text = 
`📦 **AVAILABLE INVENTORY (${stock.length} Accounts in Stock)**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    stock.slice(0, 10).forEach((s) => {
        text += `🔹 **Stock #${s.id} | ${s.product_name}**\n`;
        text += `\`\`\`\n${s.account_content}\n\`\`\`\n`;
        text += `🗑️ To delete: \`/delstock ${s.id}\`\n\n`;
    });

    await ctx.replyWithMarkdown(text, Markup.inlineKeyboard([
        [Markup.button.callback('👑 Back to Admin Dashboard', 'admin_main_dashboard')]
    ]));
});

// Admin Command: /delstock <id>
bot.command('delstock', async (ctx) => {
    if (!isOwner(ctx)) return ctx.reply('⛔ Access denied.');
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 2) return ctx.reply('Usage: /delstock <stock_id>');
    const id = parseInt(parts[1], 10);
    db.deleteStockAccount(id);
    await ctx.reply(`🗑️ Stock item #${id} deleted.`);
});

// Admin Action: Pending Deposits
bot.action('admin_pending_deps', async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCbQuery('⛔ Access denied.');
    await ctx.answerCbQuery();
    const pendingDeposits = db.getPendingDeposits();

    if (pendingDeposits.length === 0) {
        return ctx.replyWithMarkdown('✅ No pending deposits at this time.', Markup.inlineKeyboard([
            [Markup.button.callback('👑 Back to Dashboard', 'admin_main_dashboard')]
        ]));
    }

    for (const dep of pendingDeposits.slice(0, 5)) {
        const depUser = dep.username ? `@${dep.username}` : 'unknown';
        const depText = 
`⏳ **Pending Deposit #DEP-${dep.id}**
👤 User: \`${depUser}\` (ID: \`${dep.user_id}\`)
💰 Amount: \`$${dep.amount.toFixed(2)}\`
🔢 Binance Order ID / Info:
\`${dep.tx_id}\``;

        const depKeyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback(`✅ Approve (+$${dep.amount.toFixed(2)})`, `approve_dep_${dep.id}`),
                Markup.button.callback('❌ Reject', `reject_dep_${dep.id}`)
            ]
        ]);
        await ctx.replyWithMarkdown(depText, depKeyboard);
    }
});

// Admin Action: Users List
bot.action('admin_list_users', async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCbQuery('⛔ Access denied.');
    await ctx.answerCbQuery();
    const users = db.getAllUsers();

    let text = `👥 **REGISTERED USERS (${users.length} Total)**\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    users.slice(0, 25).forEach((u) => {
        const uHandle = u.username ? `@${u.username}` : 'no_username';
        text += `• \`${u.id}\` | \`${uHandle}\` | Balance: \`$${u.balance.toFixed(2)}\`\n`;
    });

    await ctx.replyWithMarkdown(text, Markup.inlineKeyboard([
        [Markup.button.callback('👑 Back to Dashboard', 'admin_main_dashboard')]
    ])).catch(async () => {
        await ctx.reply(text.replace(/[*`]/g, ''), Markup.inlineKeyboard([
            [Markup.button.callback('👑 Back to Dashboard', 'admin_main_dashboard')]
        ]));
    });
});

// Admin Action: Prompt Add Balance
bot.action('admin_prompt_addbalance', async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCbQuery('⛔ Access denied.');
    await ctx.answerCbQuery();
    await ctx.replyWithMarkdown(
`💳 **CREDIT USER BALANCE**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Send command in chat:
\`/addbalance <UserID> <amount>\`

Example:
\`/addbalance 123456789 5.50\``,
        Markup.inlineKeyboard([
            [Markup.button.callback('👑 Back to Dashboard', 'admin_main_dashboard')]
        ])
    );
});

// Admin Action: Prompt Broadcast
bot.action('admin_prompt_broadcast', async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCbQuery('⛔ Access denied.');
    await ctx.answerCbQuery();
    userStates.set(ctx.from.id, { step: 'admin_broadcasting' });
    await ctx.replyWithMarkdown(
`📢 **BROADCAST MESSAGE TO ALL USERS**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Please send the announcement message you want to broadcast to all registered users.

Type \`/cancel\` to abort.`
    );
});

// Helper: Generate and send complete SQL & Database backup to chat
async function sendDatabaseBackup(ctxOrChatId, isAuto = false) {
    const chatId = typeof ctxOrChatId === 'object' && ctxOrChatId.chat ? ctxOrChatId.chat.id : ctxOrChatId;
    try {
        const backupResult = db.saveLocalBackup();
        const sqlBuffer = Buffer.from(backupResult.sqlContent, 'utf-8');
        const dbPath = db.getDbPath();

        const stats = db.getUserStats();
        const availableStock = db.getAllAvailableStock().length;

        const caption = 
`${isAuto ? '🤖 **AUTOMATED 24-HOUR SQL BACKUP**' : '💾 **SQL & DATABASE BACKUP EXPORT**'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 **Timestamp:** \`${new Date().toISOString().replace('T', ' ').substring(0, 19)}\`
👥 **Total Registered Users:** \`${stats.totalUsers}\`
📦 **Total Orders Fulfilled:** \`${stats.totalOrders}\`
💳 **Approved Deposits:** \`$${stats.totalDeposits.toFixed(2)}\`
🧠 **Stock Accounts in DB:** \`${availableStock} accounts\`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ *Both readable .SQL dump and SQLite .DB binary are attached.*`;

        // 1. Send .SQL Dump File
        await bot.telegram.sendDocument(chatId, {
            source: sqlBuffer,
            filename: backupResult.sqlFileName
        }, {
            caption: caption,
            parse_mode: 'Markdown'
        });

        // 2. Send .DB Binary File
        if (fs.existsSync(dbPath)) {
            await bot.telegram.sendDocument(chatId, {
                source: fs.createReadStream(dbPath),
                filename: backupResult.dbFileName
            }, {
                caption: `💾 **SQLite Database Binary (.db)**\nFilename: \`${backupResult.dbFileName}\``,
                parse_mode: 'Markdown'
            });
        }

        console.log(`✅ SQL Backup generated and delivered to chat ${chatId}`);
        return true;
    } catch (err) {
        console.error('Error generating/sending SQL backup:', err);
        await bot.telegram.sendMessage(chatId, `⚠️ **Backup Error:** ${err.message}`, { parse_mode: 'Markdown' }).catch(() => {});
        return false;
    }
}

// Admin Action: Download SQL & DB Backup
bot.action('admin_backup_db', async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCbQuery('⛔ Access denied.');
    await ctx.answerCbQuery('⏳ Generating SQL backup...');
    await ctx.reply('⏳ **Generating SQL Dump & Database archive...** Please wait a few seconds.');
    await sendDatabaseBackup(ctx, false);
});

// Admin Command: /backup, /sqldump, /savedb, /exportsql
bot.command(['backup', 'sqldump', 'savedb', 'exportsql'], async (ctx) => {
    if (!isOwner(ctx)) return ctx.reply('⛔ Access Denied. Only the bot Owner can download SQL backups.');
    await ctx.reply('⏳ **Generating SQL Dump & Database archive...**');
    await sendDatabaseBackup(ctx, false);
});

// Admin Action: Prompt Restore
bot.action('admin_prompt_restore_db', async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCbQuery('⛔ Access denied.');
    await ctx.answerCbQuery();
    userStates.set(ctx.from.id, { step: 'admin_awaiting_restore' });

    const text = 
`📥 **RESTORE SQL DATABASE**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
To restore your database from a backup:

1️⃣ Send / upload your **\`.sql\`** dump file directly to this chat (or paste raw SQL queries).
2️⃣ The bot will execute the SQL script and immediately restore all tables, users, balances, and inventory!

⚠️ *Note: Restoring will overwrite existing records with the data inside the SQL file.*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👉 *Upload your \`.sql\` file now, or press cancel below:*`;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Cancel / Back to Admin', 'admin_main_dashboard')]
    ]);

    await ctx.replyWithMarkdown(text, keyboard);
});

// Document Handler for SQL Restore
bot.on('document', async (ctx) => {
    if (!isOwner(ctx)) return;

    const doc = ctx.message.document;
    const fileName = (doc.file_name || '').toLowerCase();
    const state = userStates.get(ctx.from.id);

    const isRestoreIntent = (state && state.step === 'admin_awaiting_restore') || 
                            fileName.endsWith('.sql') ||
                            (ctx.message.caption && ctx.message.caption.toLowerCase().includes('restore'));

    if (!isRestoreIntent) return;

    if (!fileName.endsWith('.sql')) {
        return ctx.reply('⚠️ Please upload a valid **.sql** backup file.');
    }

    try {
        await ctx.reply('⏳ **Reading and executing SQL backup script...**');
        const fileLink = await ctx.telegram.getFileLink(doc.file_id);
        const response = await fetch(fileLink.href);
        const sqlContent = await response.text();

        // Safety backup of current state first
        db.saveLocalBackup();

        // Execute SQL script
        db.executeSql(sqlContent);
        userStates.delete(ctx.from.id);

        const stats = db.getUserStats();
        const availableStock = db.getAllAvailableStock().length;

        const successMsg = 
`✅ **DATABASE RESTORED SUCCESSFULLY!**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📁 **Restored From:** \`${doc.file_name}\`
👥 **Total Registered Users:** \`${stats.totalUsers}\`
📦 **Total Orders:** \`${stats.totalOrders}\`
💳 **Approved Deposits:** \`$${stats.totalDeposits.toFixed(2)}\`
🧠 **Real Inventory Stock:** \`${availableStock} accounts\`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎉 *All data, user balances, and inventory are restored and active!*`;

        await ctx.replyWithMarkdown(successMsg, Markup.inlineKeyboard([
            [Markup.button.callback('👑 Open Admin Panel', 'admin_main_dashboard')]
        ]));
    } catch (err) {
        console.error('SQL Restore Error:', err);
        await ctx.reply(`❌ **SQL Restore Failed:** ${err.message}`);
    }
});

// Admin command: /addbalance <userId> <amount>
bot.command('addbalance', async (ctx) => {
    if (!isOwner(ctx)) {
        return ctx.reply('⛔ Access denied.');
    }

    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 3) {
        return ctx.reply('Usage: /addbalance <User_ID> <amount>\nExample: /addbalance 123456789 10');
    }

    const targetUserId = parseInt(parts[1], 10);
    const amount = parseFloat(parts[2]);

    if (isNaN(targetUserId) || isNaN(amount)) {
        return ctx.reply('❌ Invalid User ID or amount format.');
    }

    const targetUser = db.getUser(targetUserId);
    if (!targetUser) {
        return ctx.reply('❌ User not found in database.');
    }

    const updated = db.updateBalance(targetUserId, amount);
    await ctx.reply(`✅ Successfully added $${amount.toFixed(2)} to User \`${targetUserId}\`. New Balance: $${updated.balance.toFixed(2)}`, { parse_mode: 'Markdown' });

    // Notify user
    bot.telegram.sendMessage(
        targetUserId,
        `🎉 **YOUR BALANCE HAS BEEN CREDITED!**\n\n➕ Added: \`+$${amount.toFixed(2)}\`\n💳 Current Balance: \`$${updated.balance.toFixed(2)}\``,
        { parse_mode: 'Markdown' }
    ).catch(() => {});
});

// Approve Deposit Action
bot.action(/^approve_dep_(\d+)$/, async (ctx) => {
    if (!isOwner(ctx)) {
        return ctx.answerCbQuery('⛔ Admin access required.');
    }

    const depId = parseInt(ctx.match[1], 10);
    const dep = db.getDepositById(depId);

    if (!dep || dep.status !== 'pending') {
        return ctx.answerCbQuery('This deposit request has already been processed.');
    }

    db.updateDepositStatus(depId, 'approved');
    db.updateBalance(dep.user_id, dep.amount);
    const updatedUser = db.getUser(dep.user_id);

    await ctx.editMessageText(
`✅ **Deposit #DEP-${depId} APPROVED!**
Credited \`$${dep.amount.toFixed(2)}\` to User ID \`${dep.user_id}\`.`,
        { parse_mode: 'Markdown' }
    );

    // Notify user
    bot.telegram.sendMessage(
        dep.user_id,
        `🎉 **BINANCE DEPOSIT CONFIRMED!** 🎉\n\n➕ Credited: \`+$${dep.amount.toFixed(2)}\`\n💳 New Balance: \`$${updatedUser.balance.toFixed(2)}\`\n\nYou can now proceed to purchase your desired product!`,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('🛒 Browse Marketplace', 'menu_marketplace')]])
        }
    ).catch(() => {});
});

// Reject Deposit Action
bot.action(/^reject_dep_(\d+)$/, async (ctx) => {
    if (!isOwner(ctx)) {
        return ctx.answerCbQuery('⛔ Admin access required.');
    }

    const depId = parseInt(ctx.match[1], 10);
    const dep = db.getDepositById(depId);

    if (!dep || dep.status !== 'pending') {
        return ctx.answerCbQuery('This deposit request has already been processed.');
    }

    db.updateDepositStatus(depId, 'rejected');

    await ctx.editMessageText(`❌ **Deposit #DEP-${depId} REJECTED.**`, { parse_mode: 'Markdown' });

    bot.telegram.sendMessage(
        dep.user_id,
        `❌ **Deposit Request #DEP-${depId} Rejected**\n\nThe transaction ID could not be verified on Binance. Please verify your details or contact support.`,
        { parse_mode: 'Markdown' }
    ).catch(() => {});
});

// Owner Sticker Capture Tool (send any sticker to bot to extract file_id)
bot.on('sticker', async (ctx) => {
    if (!isOwner(ctx)) return;
    const sticker = ctx.message.sticker;
    const fileId = sticker.file_id;
    const stickerType = sticker.is_animated ? 'Animated (TGS)' : (sticker.is_video ? 'Video (WebM Animation)' : 'Static (HD WebP)');

    await ctx.replyWithMarkdown(
`🎯 **NEW STICKER CAPTURED!**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏷️ **Type:** ${stickerType}
😀 **Emoji:** ${sticker.emoji || 'None'}
📦 **Pack Name:** \`${sticker.set_name || 'Individual'}\`
🔑 **Telegram File ID:**
\`${fileId}\`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✨ *You can copy this ID anytime to use it anywhere in the bot!*`
    );
});

// Handle TXID Submission & Screenshot Messages & Admin Steps
bot.on(['text', 'photo'], async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    const textMsg = ctx.message.text ? ctx.message.text.trim() : '';

    // 1. Admin Add Stock Step
    if (isOwner(ctx) && state && state.step === 'admin_adding_stock') {
        if (textMsg === '/cancel') {
            userStates.delete(userId);
            return ctx.reply('❌ Add stock cancelled.', getMainKeyboard(ctx));
        }

        const raw = ctx.message.text || '';
        const items = raw.split(/\n\s*---\s*\n/).map(s => s.trim()).filter(Boolean);
        let addedCount = 0;
        for (const item of items) {
            if (item) {
                db.addStockAccount(state.productId, item);
                addedCount++;
            }
        }
        userStates.delete(userId);
        const newTotal = db.getAvailableStockCount(state.productId);
        const addMoreAction = (state.productName && state.productName.includes('Teacher')) ? 'admin_add_stock_teacher' : 'admin_add_stock_plus';

        return ctx.replyWithMarkdown(
`✅ **STOCK UPDATED SUCCESSFULLY!**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 Product: **${state.productName}**
➕ Accounts Added: **${addedCount}**
📊 Total In Stock Now: **${newTotal}**`,
            Markup.inlineKeyboard([
                [Markup.button.callback('➕ Add More Accounts', addMoreAction)],
                [Markup.button.callback('👑 Return to Dashboard', 'admin_main_dashboard')]
            ])
        );
    }

    // 2. Admin Broadcast Step
    if (isOwner(ctx) && state && state.step === 'admin_broadcasting') {
        if (textMsg === '/cancel') {
            userStates.delete(userId);
            return ctx.reply('❌ Broadcast cancelled.', getMainKeyboard(ctx));
        }
        userStates.delete(userId);
        const users = db.getAllUsers();
        let sentCount = 0;
        for (const u of users) {
            try {
                await bot.telegram.sendMessage(u.id, textMsg, { parse_mode: 'Markdown' });
                sentCount++;
            } catch (e) {}
        }
        return ctx.reply(`📢 Broadcast successfully delivered to ${sentCount} user(s)!`, getMainKeyboard(ctx));
    }

    // 2.5 Admin SQL Restore Step
    if (isOwner(ctx) && state && state.step === 'admin_awaiting_restore') {
        if (textMsg === '/cancel') {
            userStates.delete(userId);
            return ctx.reply('❌ SQL Restore cancelled.', getMainKeyboard(ctx));
        }
        if (textMsg.toUpperCase().includes('INSERT INTO') || textMsg.toUpperCase().includes('CREATE TABLE')) {
            try {
                db.saveLocalBackup();
                db.executeSql(textMsg);
                userStates.delete(userId);
                const stats = db.getUserStats();
                return ctx.reply(`✅ **Raw SQL executed and saved!**\nUsers: ${stats.totalUsers} | Orders: ${stats.totalOrders}`);
            } catch (err) {
                return ctx.reply(`❌ **SQL Error:** ${err.message}`);
            }
        }
    }

    // 3. User Message Log for Owner @Giooo12be
    const menuButtons = [
        '🛒 Marketplace', '💰 Wallet', '📦 My Orders', '💬 Owner Support',
        '💳 Deposit (Binance)', '👤 My Profile',
        '👑 Owner Admin Panel', '/start', '/admin'
    ];
    if (currentAdminId && !isOwner(ctx) && !menuButtons.includes(textMsg)) {
        const preview = ctx.message.text ? ctx.message.text : (ctx.message.caption ? `[Photo]: ${ctx.message.caption}` : '[User sent Media]');
        const uHandle = ctx.from.username ? `@${ctx.from.username}` : 'No username';
        const cleanPreview = preview.replace(/[`*]/g, '');
        bot.telegram.sendMessage(
            currentAdminId,
            `💬 **[USER MESSAGE LOG]**\n👤 User: \`${uHandle}\` (ID: \`${ctx.from.id}\` | Name: ${ctx.from.first_name || ''})\n📝 Message:\n"${cleanPreview}"`,
            { parse_mode: 'Markdown' }
        ).catch(() => {});
    }

    // Check if user is in awaiting_txid state OR directly pasted a Binance Order ID (16-24 digits)
    const isDigitsOnly = /^\d{16,24}$/.test(textMsg);
    const hasOrderPattern = /\b\d{16,24}\b/.test(textMsg);

    if ((state && state.step === 'awaiting_txid') || isDigitsOnly || hasOrderPattern) {
        const fallbackAmount = (state && state.invoiceAmount) ? Number(state.invoiceAmount) : 5.50;
        userStates.delete(userId);

        let txText = ctx.message.text || (ctx.message.caption ? ctx.message.caption : 'Receipt Screenshot');

        // Extract potential 16-24 digit Binance Order ID or clean string
        const orderIdMatch = txText.match(/\b\d{16,24}\b/);
        const extractedOrderId = orderIdMatch ? orderIdMatch[0] : txText.trim();

        // Check if Order ID was already used
        if (db.checkTxIdExists(extractedOrderId)) {
            return ctx.replyWithMarkdown(
`💳 Payment
──────────────
⚠️ **Status: ❌ Already Processed**
This Binance Pay Order ID (\`${extractedOrderId}\`) has already been credited to a wallet.

Each payment can only be redeemed once.`,
                getMainKeyboard(ctx)
            );
        }

        // Send animated live progress message (Step 1)
        const waitMsg = await ctx.replyWithMarkdown(
`⚡ **Processing Payment Verification...**
\`[ ▰▰▰▱▱▱▱▱▱▱ ] 30%\`
📡 Connecting to Binance Pay Gateway...`
        );

        await new Promise((r) => setTimeout(r, 400));
        // Step 2
        await bot.telegram.editMessageText(
            ctx.chat.id,
            waitMsg.message_id,
            null,
`⚡ **Processing Payment Verification...**
\`[ ▰▰▰▰▰▰▰▱▱▱ ] 70%\`
🔍 Querying Order ID: \`${extractedOrderId}\`...`,
            { parse_mode: 'Markdown' }
        ).catch(() => {});

        // 1. Attempt Automated Binance Pay API verification
        const binanceCheck = await binance.checkBinancePayOrder(extractedOrderId);

        if (binanceCheck.configured && binanceCheck.success && binanceCheck.found) {
            // Step 3: Verified!
            await bot.telegram.editMessageText(
                ctx.chat.id,
                waitMsg.message_id,
                null,
`🟢 **Binance Pay Verified!**
\`[ ▰▰▰▰▰▰▰▰▰▰ ] 100%\`
✨ Crediting your wallet balance...`,
                { parse_mode: 'Markdown' }
            ).catch(() => {});

            await new Promise((r) => setTimeout(r, 300));
            bot.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});

            // AUTOMATIC VERIFICATION SUCCESS
            const verifiedAmount = binanceCheck.amount || fallbackAmount;
            const depId = db.createDeposit(userId, ctx.from.username, verifiedAmount, 'Binance Auto-API', extractedOrderId);
            db.updateDepositStatus(depId, 'approved');
            const updatedUser = db.updateBalance(userId, verifiedAmount);

            const walletText = buildWalletText(userId);
            const autoSuccessText = `🎉 **Payment Confirmed!**\n\n${walletText}`;

            await ctx.replyWithMarkdown(autoSuccessText, Markup.inlineKeyboard([
                [Markup.button.callback('➕ Add funds', 'deposit_binance')],
                [Markup.button.callback('🛒 Marketplace', 'menu_marketplace')],
                [Markup.button.callback('📦 My Orders', 'menu_orders')]
            ]));

            if (currentAdminId) {
                bot.telegram.sendMessage(
                    currentAdminId,
                    `⚡ **AUTOMATIC BINANCE DEPOSIT CONFIRMED!**\n👤 User: @${ctx.from.username || 'unknown'} (ID: \`${userId}\`)\n🔢 Order ID: \`${extractedOrderId}\`\n💵 Received: \`${verifiedAmount.toFixed(3)} USDT\``,
                    { parse_mode: 'Markdown' }
                ).catch(() => {});
            }
            return;
        }

        // Delete temporary progress message if not found via auto-API
        bot.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});

        // 2. If not found on Binance API or fallback
        const depId = db.createDeposit(userId, ctx.from.username, fallbackAmount, 'Binance Pay', extractedOrderId);

        const pendingText = 
`💳 Payment
──────────────
💳 Method: Binance Pay
💵 Amount: \`${fallbackAmount.toFixed(3)} USDT\`
🧾 Order ID: \`${extractedOrderId}\`

🌐 Status: ⏳ Pending / Not Synced Yet
Binance has not synced this Order ID yet.

📌 If you just paid, please wait 10–15 seconds and paste the Order ID again.
*(Admin has also been notified to verify manually)*`;

        await ctx.replyWithMarkdown(pendingText, Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Check payment', 'check_payment_btn')],
            [Markup.button.callback('🔙 Back to Menu', 'menu_marketplace')]
        ]));

        // Alert Admin
        if (currentAdminId) {
            const adminAlert = 
`🔔 **NEW BINANCE DEPOSIT SUBMITTED!**
──────────────
📋 Ref: #DEP-${depId}
👤 User: @${ctx.from.username || 'unknown'} (ID: \`${userId}\`)
💵 Amount: \`${fallbackAmount.toFixed(3)} USDT\`
🧾 Order ID: \`${extractedOrderId}\``;

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback(`✅ Approve (+$${fallbackAmount.toFixed(2)})`, `approve_dep_${depId}`),
                    Markup.button.callback('❌ Reject', `reject_dep_${depId}`)
                ]
            ]);

            bot.telegram.sendMessage(currentAdminId, adminAlert, { parse_mode: 'Markdown', ...keyboard }).catch(() => {});
        }
        return;
    }

    // Default reply
    await ctx.reply('Please use the menu below to navigate 👇', getMainKeyboard(ctx));
});

// Error handling
bot.catch((err, ctx) => {
    console.error(`Error for ${ctx ? ctx.updateType : 'unknown'}:`, err && err.message ? err.message : err);
});

process.on('unhandledRejection', (reason) => {
    console.error('⚠️ Unhandled Rejection:', reason && reason.message ? reason.message : reason);
});

process.on('uncaughtException', (err) => {
    console.error('⚠️ Uncaught Exception:', err && err.message ? err.message : err);
});

// Start the bot
function start() {
    console.log('-------------------------------------------');
    console.log('🤖 AI Marketplace Telegram Bot Starting...');
    console.log(`🔑 Bot Token: ${config.BOT_TOKEN.substring(0, 10)}...`);
    console.log(`💳 Binance Pay ID: ${config.BINANCE_PAY_ID}`);
    console.log('📦 Database: SQLite Ready.');
    console.log('-------------------------------------------');

    // Automatically synchronize Telegram profile bio & description
    bot.telegram.setMyShortDescription(
        '⚡ Premium ChatGPT Plus & AI Store. Instant Auto-Delivery & Warranty. Support: @Giooo12be'
    ).catch(() => {});

    bot.telegram.setMyDescription(
        '💎 Welcome to AI Marketplace!\n#1 trusted digital store for ChatGPT Plus & educational AI accounts.\n\n🟢 ChatGPT Plus (1 Month) — $5.50\n🎓 GPT K-12 Teacher Plan (2 Years) — $6.50\n\n⚡ Instant Automated Delivery\n🛡️ Full Warranty & 2FA Access\n💳 Binance Pay Accepted\n💬 Owner Support: @Giooo12be'
    ).catch(() => {});

    bot.launch(() => {
        console.log('✅ Bot is LIVE and listening for Telegram updates!');
    }).catch((err) => {
        console.error('❌ Bot Launch Error:', err);
    });

    // Automatic 24-Hour SQL & Database Backup to Owner
    setInterval(() => {
        if (currentAdminId) {
            console.log('⏰ Running automatic 24-hour SQL backup for Owner...');
            sendDatabaseBackup(currentAdminId, true).catch(err => {
                console.error('Auto backup error:', err.message);
            });
        }
    }, 24 * 60 * 60 * 1000);
}

start();

// Graceful stop
process.once('SIGINT', () => {
    httpServer.close();
    bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
    httpServer.close();
    bot.stop('SIGTERM');
});
