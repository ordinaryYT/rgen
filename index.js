require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes,
    EmbedBuilder
} = require('discord.js');

const axios = require('axios');
const express = require('express');
const fs = require('fs');

// =========================
// DISCORD CLIENT
// =========================

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

// =========================
// WEB SERVER
// =========================

const app = express();

app.get('/', (req, res) => {
    res.send('Bot Online');
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// =========================
// KEEP ALIVE
// =========================

setInterval(async () => {

    try {

        await axios.get('https://rgen.onrender.com');

        console.log('Keepalive ping sent');

    } catch (err) {

        console.log('Keepalive failed');

    }

}, 60 * 1000);

// =========================
// STOCK FILES
// =========================

const STOCK_FILES = {

    // normal accounts
    "200day": "./200day.txt",
    "5year": "./5year.txt",

    // quickgen
    "200quick": "./200+plus quickgen.txt",
    "5quick": "./5 year+ quickgen.txt"
};

// =========================
// STOCK CACHE
// =========================

const stock = {

    // normal accounts
    "200day": [],
    "5year": [],

    // quickgen
    "200quick": [],
    "5quick": []
};

// =========================
// LOAD STOCK
// =========================

function loadStock(type) {

    try {

        const file = fs.readFileSync(
            STOCK_FILES[type],
            'utf8'
        );

        const lines = file
            .split('\n')
            .map(x => x.trim())
            .filter(Boolean);

        stock[type] = [];

        for (const line of lines) {

            const parts = line.split(':');

            if (parts.length < 2) continue;

            // QUICKGEN
            if (type === '200quick' || type === '5quick') {

                const cookie = parts[0].trim();

                stock[type].push({
                    username: cookie,
                    password: parts.slice(1).join(':').trim()
                });

            } else {

                // NORMAL GEN
                const username = parts[0].trim();
                const password = parts.slice(1).join(':').trim();

                stock[type].push({
                    username,
                    password
                });
            }
        }

        console.log(
            `${type} stock loaded: ${stock[type].length}`
        );

    } catch (err) {

        console.log(`Failed loading ${type}`);

    }
}

// =========================
// REMOVE USED ACCOUNT
// =========================

function removeUsedAccount(type, usedAccount) {

    try {

        const file = fs.readFileSync(
            STOCK_FILES[type],
            'utf8'
        );

        const lines = file
            .split('\n')
            .filter(Boolean);

        const updated = lines.filter(line => {

            const clean = line.trim();

            return clean !== `${usedAccount.username}:${usedAccount.password}`;

        });

        fs.writeFileSync(
            STOCK_FILES[type],
            updated.join('\n')
        );

    } catch (err) {

        console.log('Failed updating txt file');

    }
}

// =========================
// REFRESH STOCK
// =========================

function refreshAllStock() {

    loadStock('200day');
    loadStock('5year');

    loadStock('200quick');
    loadStock('5quick');
}

// refresh every minute
setInterval(() => {

    refreshAllStock();

}, 60 * 1000);

// =========================
// READY EVENT
// =========================

client.once('ready', async () => {

    console.log(`${client.user.tag} online`);

    refreshAllStock();

    const commands = [

        // =========================
        // GEN
        // =========================

        new SlashCommandBuilder()
            .setName('gen')
            .setDescription('Generate account')
            .addStringOption(option =>
                option
                    .setName('type')
                    .setDescription('Choose account type')
                    .setRequired(true)
                    .addChoices(
                        {
                            name: '200 Day Old + Accounts',
                            value: '200day'
                        },
                        {
                            name: '5 Year Old + Accounts',
                            value: '5year'
                        }
                    )
            ),

        // =========================
        // QUICKGEN
        // =========================

        new SlashCommandBuilder()
            .setName('quickgen')
            .setDescription('Generate account')
            .addStringOption(option =>
                option
                    .setName('type')
                    .setDescription('Choose account type')
                    .setRequired(true)
                    .addChoices(
                        {
                            name: '200 Day Old + Accounts',
                            value: '200quick'
                        },
                        {
                            name: '5 Year Old + Accounts',
                            value: '5quick'
                        }
                    )
            ),

        // =========================
        // STOCK
        // =========================

        new SlashCommandBuilder()
            .setName('stock')
            .setDescription('Check stock')

    ].map(cmd => cmd.toJSON());

    const rest = new REST({
        version: '10'
    }).setToken(process.env.DISCORD_TOKEN);

    await rest.put(
        Routes.applicationCommands(client.user.id),
        {
            body: commands
        }
    );

    console.log('Commands registered');

});

// =========================
// COMMAND HANDLER
// =========================

client.on('interactionCreate', async interaction => {

    if (!interaction.isChatInputCommand()) return;

    // =========================
    // STOCK COMMAND
    // =========================

    if (interaction.commandName === 'stock') {

        const embed = new EmbedBuilder()
            .setTitle('Current Stock')
            .setDescription(

                `## 200 Day Old + Accounts\n` +
                `${stock["200day"].length} Accounts\n\n` +

                `## 5 Year Old + Accounts\n` +
                `${stock["5year"].length} Accounts\n\n` +

                `## 200 Day Old + Quickgen\n` +
                `${stock["200quick"].length} Accounts\n\n` +

                `## 5 Year Old + Quickgen\n` +
                `${stock["5quick"].length} Accounts`

            )
            .setColor('Blue');

        return interaction.reply({
            embeds: [embed],
            ephemeral: true
        });
    }

    // =========================
    // GEN COMMAND
    // =========================

    if (interaction.commandName === 'gen') {

        const type = interaction.options.getString('type');

        if (stock[type].length === 0) {

            return interaction.reply({
                content: 'Out of stock.',
                ephemeral: true
            });
        }

        const acc = stock[type].shift();

        removeUsedAccount(type, acc);

        const typeName =
            type === '200day'
                ? '200 Day Old + Account'
                : '5 Year Old + Account';

        try {

            const channel = await interaction.guild.channels.create({

                name: `🎉・${interaction.user.username}`,

                type: 0,

                permissionOverwrites: [

                    {
                        id: interaction.guild.roles.everyone.id,
                        deny: ['ViewChannel']
                    },

                    {
                        id: interaction.user.id,
                        allow: [
                            'ViewChannel',
                            'SendMessages',
                            'ReadMessageHistory'
                        ]
                    },

                    {
                        id: client.user.id,
                        allow: [
                            'ViewChannel',
                            'SendMessages',
                            'ManageChannels',
                            'ReadMessageHistory'
                        ]
                    }
                ]
            });

            const embed = new EmbedBuilder()

                .setTitle('✅ Account Generated')

                .setDescription(

                    `## ${typeName}\n\n` +

                    `👤 **Username**\n` +
                    `\`${acc.username}\`\n\n` +

                    `🔑 **Password**\n` +
                    `\`${acc.password}\`\n\n` +

                    `📌 Keep this account safe.`

                )

                .setColor('Green')

                .setFooter({
                    text: 'Generated Successfully'
                });

            await channel.send({
                content: `<@${interaction.user.id}>`,
                embeds: [embed]
            });

            return interaction.reply({

                content:
                    `Your account has been created: ${channel}`,

                ephemeral: true
            });

        } catch (err) {

            console.log(err);

            return interaction.reply({

                content:
                    'Failed creating private channel.',

                ephemeral: true
            });
        }
    }

    // =========================
    // QUICKGEN COMMAND
    // =========================

    if (interaction.commandName === 'quickgen') {

        const type = interaction.options.getString('type');

        if (stock[type].length === 0) {

            return interaction.reply({
                content: 'Out of stock.',
                ephemeral: true
            });
        }

        const acc = stock[type].shift();

        removeUsedAccount(type, acc);

        const typeName =
            type === '200quick'
                ? '200 Day Old + Account'
                : '5 Year Old + Account';

        try {

            const channel = await interaction.guild.channels.create({

                name: `🍪・${interaction.user.username}`,

                type: 0,

                permissionOverwrites: [

                    {
                        id: interaction.guild.roles.everyone.id,
                        deny: ['ViewChannel']
                    },

                    {
                        id: interaction.user.id,
                        allow: [
                            'ViewChannel',
                            'SendMessages',
                            'ReadMessageHistory'
                        ]
                    },

                    {
                        id: client.user.id,
                        allow: [
                            'ViewChannel',
                            'SendMessages',
                            'ManageChannels',
                            'ReadMessageHistory'
                        ]
                    }
                ]
            });

            const embed = new EmbedBuilder()

                .setTitle('✅ Account Generated')

                .setDescription(

                    `## ${typeName}\n\n` +

                    `🍪 **Cookie**\n` +
                    `\`\`\`\n${acc.username}\n\`\`\`\n\n` +

                    `📌 Keep this account safe.\n\n` +

                    `❓ **Need help? Look here**\n` +
                    `https://discord.com/channels/1466562322947637475/1504054798868287608`

                )

                .setColor('Orange')

                .setFooter({
                    text: 'Generated Successfully'
                });

            await channel.send({
                content: `<@${interaction.user.id}>`,
                embeds: [embed]
            });

            return interaction.reply({

                content:
                    `Your account has been created: ${channel}`,

                ephemeral: true
            });

        } catch (err) {

            console.log(err);

            return interaction.reply({

                content:
                    'Failed creating private channel.',

                ephemeral: true
            });
        }
    }
});

// =========================
// LOGIN
// =========================

client.login(process.env.DISCORD_TOKEN);
