require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

const fs = require('fs');
const axios = require('axios');
const express = require('express');
const Database = require('better-sqlite3');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

const app = express();
app.get('/', (req, res) => res.send('Bot Online'));
app.listen(process.env.PORT || 3000);

setInterval(() => axios.get('https://rgen.onrender.com').catch(() => {}), 60000);

// Database
const db = new Database('./stock.db');

db.exec(`
    CREATE TABLE IF NOT EXISTS specific (
        username TEXT PRIMARY KEY,
        password TEXT,
        age INTEGER
    );
    CREATE TABLE IF NOT EXISTS random (
        username TEXT PRIMARY KEY,
        password TEXT
    );
`);

function importStock() {
    db.prepare('DELETE FROM specific').run();
    db.prepare('DELETE FROM random').run();

    try {
        const data = fs.readFileSync('./specific.txt', 'utf8');
        const stmt = db.prepare('INSERT INTO specific (username, password, age) VALUES (?, ?, ?)');
        data.split('\n').forEach(line => {
            const t = line.trim();
            if (!t) return;
            const [u, p, a] = t.split(':');
            if (u && p) stmt.run(u.trim(), p.trim(), parseInt(a) || 0);
        });
    } catch (e) {}

    try {
        const data = fs.readFileSync('./random.txt', 'utf8');
        const stmt = db.prepare('INSERT INTO random (username, password) VALUES (?, ?)');
        data.split('\n').forEach(line => {
            const t = line.trim();
            if (!t) return;
            const [u, p] = t.split(':');
            if (u && p) stmt.run(u.trim(), p.trim());
        });
    } catch (e) {}
}

function removeAccount(type, username) {
    const table = type === 'specific' ? 'specific' : 'random';
    db.prepare(`DELETE FROM ${table} WHERE username = ?`).run(username);
}

function findClosestSpecific(requestedAge) {
    const acc = db.prepare('SELECT * FROM specific ORDER BY ABS(age - ?) ASC LIMIT 1').get(requestedAge);
    if (acc) removeAccount('specific', acc.username);
    return acc;
}

function getRandomAccount() {
    const acc = db.prepare('SELECT * FROM random ORDER BY RANDOM() LIMIT 1').get();
    if (acc) removeAccount('random', acc.username);
    return acc;
}

// Ready
client.once('ready', async () => {
    console.log(`${client.user.tag} online`);
    importStock();

    const commands = [
        new SlashCommandBuilder()
            .setName('genpanel')
            .setDescription('Post the generator panel')
            .setDefaultMemberPermissions(8)
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
});

// Interactions
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand() && interaction.commandName === 'genpanel') {
        const embed = new EmbedBuilder()
            .setTitle('Roblox Account Generator')
            .setDescription('Click the button to generate an account')
            .setColor('Blurple');

        const button = new ButtonBuilder()
            .setCustomId('generate_account')
            .setLabel('Generate Account')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🔑');

        await interaction.reply({
            embeds: [embed],
            components: [new ActionRowBuilder().addComponents(button)]
        });
    }

    if (interaction.isButton() && interaction.customId === 'generate_account') {
        const modal = new ModalBuilder()
            .setCustomId('age_modal')
            .setTitle('Request Account');

        const input = new TextInputBuilder()
            .setCustomId('requested_age')
            .setLabel('Desired Age in Days')
            .setPlaceholder('Leave blank for random')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);

        await interaction.showModal(modal.addComponents(new ActionRowBuilder().addComponents(input)));
    }

    if (interaction.isModalSubmit() && interaction.customId === 'age_modal') {
        await interaction.deferReply({ ephemeral: true });

        const input = interaction.fields.getTextInputValue('requested_age').trim();
        const requestedAge = input ? parseInt(input) : NaN;

        const acc = isNaN(requestedAge) ? getRandomAccount() : findClosestSpecific(requestedAge);

        if (!acc) {
            return interaction.editReply({ content: 'Out of stock.' });
        }

        try {
            const channel = await interaction.guild.channels.create({
                name: `🎉・${interaction.user.username}`,
                type: 0,
                permissionOverwrites: [
                    { id: interaction.guild.roles.everyone.id, deny: ['ViewChannel'] },
                    { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
                    { id: client.user.id, allow: ['ViewChannel', 'SendMessages', 'ManageChannels', 'ReadMessageHistory'] }
                ]
            });

            const embed = new EmbedBuilder()
                .setTitle('Account Generated')
                .setColor('Green')
                .setDescription(
                    `**Username**\n\`${acc.username}\`\n\n` +
                    `**Password**\n\`${acc.password}\`\n\n` +
                    `**Account Age**\n${acc.age ? acc.age + ' days' : 'Random'}\n\n` +
                    `**Requested**\n${isNaN(requestedAge) ? 'Random' : requestedAge + ' days'}`
                );

            await channel.send({ content: `<@${interaction.user.id}>`, embeds: [embed] });

            await interaction.editReply({ content: `Account sent to ${channel}` });

        } catch (err) {
            await interaction.editReply({ content: 'Failed to create channel.' });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
