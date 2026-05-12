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
// RENDER WEB SERVER
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
// KEEP RENDER AWAKE
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
    "200day": "./200day.txt",
    "5year": "./5year.txt"
};

// =========================
// STOCK
// =========================

const stock = {
    "200day": [],
    "5year": []
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

            const username = parts[0].trim();
            const password = parts.slice(1).join(':').trim();

            stock[type].push({
                username,
                password
            });
        }

        console.log(
            `${type} stock loaded: ${stock[type].length}`
        );

    } catch (err) {

        console.log(
            `Failed loading ${type} stock`
        );
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
                            name: '200 Day Old Accounts +',
                            value: '200day'
                        },
                        {
                            name: '5 Year Old Accounts +',
                            value: '5year'
                        }
                    )
            ),

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
// COMMANDS
// =========================

client.on('interactionCreate', async interaction => {

    if (!interaction.isChatInputCommand()) return;

    // =========================
    // STOCK COMMAND
    // =========================

    if (interaction.commandName === 'stock') {

        const embed = new EmbedBuilder()
            .setTitle('📦 Current Stock')
            .setDescription(

                `## 200 Day Old Accounts +\n` +
                `📁 ${stock["200day"].length} Accounts\n\n` +

                `## 5 Year Old Accounts +\n` +
                `📁 ${stock["5year"].length} Accounts`

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
                content: '❌ Out of stock.',
                ephemeral: true
            });
        }

        // get account
        const acc = stock[type].shift();

        // remove from txt
        removeUsedAccount(type, acc);

        const typeName =
            type === '200day'
                ? '200 Day Old Account +'
                : '5 Year Old Account +';

        try {

            // =========================
            // CREATE PRIVATE CHANNEL
            // =========================

            const channel = await interaction.guild.channels.create({

                name: `🎉・${interaction.user.username}`,

                type: 0,

                permissionOverwrites: [

                    // hide from everyone
                    {
                        id: interaction.guild.roles.everyone.id,
                        deny: ['ViewChannel']
                    },

                    // allow user
                    {
                        id: interaction.user.id,
                        allow: [
                            'ViewChannel',
                            'SendMessages',
                            'ReadMessageHistory'
                        ]
                    },

                    // allow bot
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

            // =========================
            // ACCOUNT EMBED
            // =========================

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

            // send account in channel
            await channel.send({
                content: `<@${interaction.user.id}>`,
                embeds: [embed]
            });

            // tell user where channel is
            return interaction.reply({

                content:
                    `✅ Your private account channel has been created: ${channel}`,

                ephemeral: true
            });

        } catch (err) {

            console.log(err);

            return interaction.reply({

                content:
                    '❌ Failed creating private channel.',

                ephemeral: true
            });
        }
    }
});

// =========================
// LOGIN
// =========================

client.login(process.env.DISCORD_TOKEN);
