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
const mongoose = require('mongoose');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

const app = express();
app.get('/', (req, res) => res.send('Bot Online'));
app.listen(process.env.PORT || 3000);

setInterval(() => axios.get('https://rgen.onrender.com').catch(() => {}), 60000);

// MongoDB Schema
const AccountSchema = new mongoose.Schema({
    username: String,
    password: String,
    age: Number,
    type: String,
    used: { type: Boolean, default: false }
});

const Account = mongoose.model('Account', AccountSchema);

const COMMON_PASSWORD = process.env.ACCOUNT_PASSWORD;

async function importStock() {
    // specific.txt = username:age
    try {
        const data = fs.readFileSync('./specific.txt', 'utf8');
        const rows = data.split('\n').map(line => {
            const t = line.trim();
            if (!t) return null;
            const [username, ageStr] = t.split(':');
            return username ? { username: username.trim(), password: COMMON_PASSWORD, age: parseInt(ageStr) || 0, type: 'specific', used: false } : null;
        }).filter(Boolean);

        if (rows.length) {
            for (let row of rows) {
                const exists = await Account.findOne({ username: row.username });
                if (!exists) {
                    await Account.create(row);
                }
            }
        }
    } catch (e) {}

    // random.txt = username:age
    try {
        const data = fs.readFileSync('./random.txt', 'utf8');
        const rows = data.split('\n').map(line => {
            const t = line.trim();
            if (!t) return null;
            const [username, ageStr] = t.split(':');
            return username ? { username: username.trim(), password: COMMON_PASSWORD, age: parseInt(ageStr) || 0, type: 'random', used: false } : null;
        }).filter(Boolean);

        if (rows.length) {
            for (let row of rows) {
                const exists = await Account.findOne({ username: row.username });
                if (!exists) {
                    await Account.create(row);
                }
            }
        }
    } catch (e) {}
}

async function getRandomAccount() {
    const acc = await Account.findOne({ type: 'random', used: false });
    if (acc) {
        acc.used = true;
        await acc.save();
        return acc;
    }
    return null;
}

async function getSpecificAccount(requestedAge) {
    const accounts = await Account.find({ type: 'specific', used: false });
    if (accounts.length === 0) return null;
    
    let closest = accounts[0];
    let minDiff = Math.abs(accounts[0].age - requestedAge);
    
    for (let account of accounts) {
        const diff = Math.abs(account.age - requestedAge);
        if (diff < minDiff) {
            minDiff = diff;
            closest = account;
        }
    }
    
    closest.used = true;
    await closest.save();
    return closest;
}

client.once('ready', async () => {
    console.log(`${client.user.tag} online`);
    
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            tls: true,
            tlsAllowInvalidCertificates: true,
            serverSelectionTimeoutMS: 30000,
            socketTimeoutMS: 30000,
        });
        console.log('Connected to MongoDB');
        await importStock();
    } catch (error) {
        console.log('MongoDB error:', error.message);
    }

    const commands = [
        new SlashCommandBuilder()
            .setName('genpanel')
            .setDescription('Post the generator panel')
            .setDefaultMemberPermissions(8)
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    } catch (e) {
        console.log('Command registration error:', e.message);
    }
});

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

        await interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] });
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

        let acc;
        let isRandom = isNaN(requestedAge);

        try {
            if (isRandom) {
                acc = await getRandomAccount();
            } else {
                acc = await getSpecificAccount(requestedAge);
            }
        } catch (e) {
            console.log('Database error:', e.message);
        }

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
                    `**Account Age**\n${acc.age} days\n\n` +
                    `**Requested**\n${isRandom ? 'Random' : requestedAge + ' days'}`
                );

            await channel.send({ content: `<@${interaction.user.id}>`, embeds: [embed] });
            await interaction.editReply({ content: `Account sent to ${channel}` });
        } catch (err) {
            await interaction.editReply({ content: 'Failed to create channel.' });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
