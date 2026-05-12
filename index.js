require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes
} = require('discord.js');

const axios = require('axios');

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

const RESTOCK_ROLE_ID = '1503761855460409485';

// STOCK
const stock = {
    alt: []
};

// LIMIT PER AUTO RESTOCK CYCLE
const RESTOCK_LIMIT = 10;

// ---------- REGISTER COMMANDS ----------
client.once('ready', async () => {
    console.log(`${client.user.tag} online`);

    const commands = [
        new SlashCommandBuilder()
            .setName('gen')
            .setDescription('Generate account'),

        new SlashCommandBuilder()
            .setName('stock')
            .setDescription('Check stock')
    ].map(c => c.toJSON());

    const rest = new REST({ version: '10' })
        .setToken(process.env.DISCORD_TOKEN);

    await rest.put(
        Routes.applicationCommands(client.user.id),
        { body: commands }
    );

    console.log('Commands ready');

    // START AUTO RESTOCK LOOP
    autoRestockLoop();
});

// ---------- AUTO RESTOCK ----------
async function autoRestock() {

    let success = 0;

    for (let i = 0; i < RESTOCK_LIMIT; i++) {

        try {

            const res = await axios.post(
                'https://core.bloxgen.net/api/generate',
                {
                    apiKey: process.env.BLOXGEN_API_KEY.trim(),
                    type: 'alt'
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );

            const data = res.data;

            if (!data.success) {
                console.log('RESTOCK FAILED:', data.message);
                continue;
            }

            stock.alt.push({
                username: data.data.username,
                password: data.data.password
            });

            success++;

        } catch (err) {
            console.log(err.response?.data || err.message);
        }

        // IMPORTANT: respect Free tier cooldown
        await sleep(30 * 60 * 1000);
    }

    console.log(`Auto-restock complete: ${success}/${RESTOCK_LIMIT}`);
}

// LOOP EVERY 30 MINUTES
function autoRestockLoop() {
    autoRestock();

    setInterval(() => {
        autoRestock();
    }, 30 * 60 * 1000);
}

// ---------- UTILS ----------
function sleep(ms) {
    return new Promise(res => setTimeout(res, ms));
}

// ---------- COMMANDS ----------
client.on('interactionCreate', async (interaction) => {

    if (!interaction.isChatInputCommand()) return;

    // STOCK
    if (interaction.commandName === 'stock') {
        return interaction.reply({
            content: `📦 Stock: ${stock.alt.length}`,
            ephemeral: true
        });
    }

    // GEN (NO COOLDOWN, UNLIMITED UNTIL EMPTY)
    if (interaction.commandName === 'gen') {

        if (stock.alt.length === 0) {
            return interaction.reply({
                content: '❌ Out of stock. Waiting for auto-restock.',
                ephemeral: true
            });
        }

        const acc = stock.alt.shift();

        try {
            await interaction.user.send(
                `USERNAME: ${acc.username}\nPASSWORD: ${acc.password}`
            );

            return interaction.reply({
                content: '✅ Sent to DMs.',
                ephemeral: true
            });

        } catch {
            return interaction.reply({
                content: '❌ Enable DMs.',
                ephemeral: true
            });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
