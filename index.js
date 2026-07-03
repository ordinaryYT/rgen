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
    birthdayAge: String, // e.g., "21+" - display only
    created: String, // e.g., "30d" - this is what users search by
    used: { type: Boolean, default: false }
});

const Account = mongoose.model('Account', AccountSchema);

const PUBLIC_CHANNEL_ID = process.env.PUBLIC_CHANNEL_ID;

// Track which accounts each user has seen
const userViewedAccounts = new Map();

function formatCreatedDate(createdStr) {
    if (createdStr.endsWith('d')) {
        return createdStr.replace('d', ' days');
    }
    if (createdStr.endsWith('m')) {
        return createdStr.replace('m', ' months');
    }
    if (createdStr.endsWith('y')) {
        return createdStr.replace('y', ' years');
    }
    return createdStr || 'Unknown';
}

async function importStock() {
    try {
        const data = fs.readFileSync('./accounts.txt', 'utf8');
        const rows = data.split('\n').map(line => {
            const t = line.trim();
            if (!t) return null;
            const parts = t.split(':');
            if (parts.length >= 4) {
                return {
                    username: parts[0].trim(),
                    password: parts[1].trim(),
                    birthdayAge: parts[2].trim() || 'Unknown',
                    created: parts[3].trim() || 'Unknown',
                    used: false
                };
            }
            return null;
        }).filter(Boolean);

        let added = 0;
        if (rows.length) {
            for (let row of rows) {
                const exists = await Account.findOne({ username: row.username });
                if (!exists) {
                    await Account.create(row);
                    added++;
                }
            }
        }
        console.log(`Added ${added} new accounts`);
    } catch (e) {
        console.log('No accounts.txt found');
    }

    const total = await Account.countDocuments({});
    const available = await Account.countDocuments({ used: false });
    console.log(`Total: ${total}, Available: ${available}`);
}

async function getRandomAccount(userId) {
    const viewed = userViewedAccounts.get(userId) || [];
    const acc = await Account.findOne({ 
        used: false,
        username: { $nin: viewed }
    });
    return acc || null;
}

async function getSpecificAccount(requestedAge, userId) {
    const viewed = userViewedAccounts.get(userId) || [];
    const accounts = await Account.find({ 
        used: false,
        username: { $nin: viewed }
    });
    if (accounts.length === 0) return null;
    
    // Find account where created date is closest to requested age
    let closest = accounts[0];
    let minDiff = Math.abs(parseInt(accounts[0].created) || 0 - requestedAge);
    
    for (let account of accounts) {
        const ageNum = parseInt(account.created) || 0;
        const diff = Math.abs(ageNum - requestedAge);
        if (diff < minDiff) {
            minDiff = diff;
            closest = account;
        }
    }
    return closest;
}

async function markAccountUsed(username) {
    const acc = await Account.findOne({ username: username, used: false });
    if (acc) {
        acc.used = true;
        await acc.save();
        return acc;
    }
    return null;
}

async function getTotalStock(userId) {
    const viewed = userViewedAccounts.get(userId) || [];
    return await Account.countDocuments({ 
        used: false,
        username: { $nin: viewed }
    });
}

async function getTotalStockGlobal() {
    return await Account.countDocuments({ used: false });
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
        console.log('Commands registered');
    } catch (e) {
        console.log('Command registration error:', e.message);
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand() && interaction.commandName === 'genpanel') {
        const total = await getTotalStockGlobal();
        const embed = new EmbedBuilder()
            .setTitle('Roblox Account Generator')
            .setDescription(`Click the button to generate an account\n\n**${total} accounts available**`)
            .setColor('Blurple');

        const button = new ButtonBuilder()
            .setCustomId('generate_account')
            .setLabel('Generate Account')
            .setStyle(ButtonStyle.Primary);

        await interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] });
    }

    if (interaction.isButton() && interaction.customId === 'generate_account') {
        const total = await getTotalStock(interaction.user.id);
        if (total === 0) {
            const globalTotal = await getTotalStockGlobal();
            if (globalTotal > 0) {
                userViewedAccounts.delete(interaction.user.id);
                return interaction.reply({ 
                    content: 'You have seen all available accounts. Starting over with fresh accounts.',
                    ephemeral: true 
                });
            }
            return interaction.reply({ content: 'Out of stock.', ephemeral: true });
        }

        const modal = new ModalBuilder()
            .setCustomId('age_modal')
            .setTitle('Request Account');

        const input = new TextInputBuilder()
            .setCustomId('requested_age')
            .setLabel('Desired Account Age in Days')
            .setPlaceholder('Leave blank for random')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);

        await interaction.showModal(modal.addComponents(new ActionRowBuilder().addComponents(input)));
    }

    if (interaction.isModalSubmit() && interaction.customId === 'age_modal') {
        await interaction.deferReply({ ephemeral: true });

        const input = interaction.fields.getTextInputValue('requested_age').trim();
        const requestedAge = input ? parseInt(input) : NaN;
        const isRandom = isNaN(requestedAge);

        let acc;
        if (isRandom) {
            acc = await getRandomAccount(interaction.user.id);
        } else {
            acc = await getSpecificAccount(requestedAge, interaction.user.id);
        }

        if (!acc) {
            const total = await getTotalStock(interaction.user.id);
            if (total === 0) {
                const globalTotal = await getTotalStockGlobal();
                if (globalTotal > 0) {
                    userViewedAccounts.delete(interaction.user.id);
                    return interaction.editReply({ 
                        content: 'You have seen all available accounts. Please try again.' 
                    });
                }
            }
            return interaction.editReply({ content: 'Out of stock.' });
        }

        if (!userViewedAccounts.has(interaction.user.id)) {
            userViewedAccounts.set(interaction.user.id, []);
        }
        userViewedAccounts.get(interaction.user.id).push(acc.username);

        try {
            const publicChannel = await client.channels.fetch(PUBLIC_CHANNEL_ID);
            
            const publicEmbed = new EmbedBuilder()
                .setTitle('Account Generated')
                .setColor(0x2B2D31)
                .setDescription('Review account details and click Keep This Account when ready')
                .addFields(
                    { name: 'Username', value: `\`${acc.username}\``, inline: false },
                    { name: 'Account Age', value: acc.birthdayAge || 'Unknown', inline: true },
                    { name: 'Created', value: formatCreatedDate(acc.created) || 'Unknown', inline: true }
                )
                .setFooter({ text: `Requested: ${isRandom ? 'Random' : requestedAge + ' days'}` });

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`keep_${acc.username}`)
                        .setLabel('Keep This Account')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`new_${interaction.user.id}`)
                        .setLabel('Generate New Account')
                        .setStyle(ButtonStyle.Primary)
                );

            await publicChannel.send({
                content: `New account generated by <@${interaction.user.id}>!`,
                embeds: [publicEmbed],
                components: [row]
            });

            await interaction.editReply({ content: `Account sent to <#${PUBLIC_CHANNEL_ID}>` });

        } catch (err) {
            console.error('Error:', err);
            await interaction.editReply({ content: 'Failed to send account.' });
        }
    }

    if (interaction.isButton() && interaction.customId.startsWith('new_')) {
        const userId = interaction.customId.split('_')[1];
        if (userId !== interaction.user.id) {
            return interaction.reply({ content: 'You did not generate this account.', ephemeral: true });
        }

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('keep_disabled')
                    .setLabel('Keep This Account')
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId('new_disabled')
                    .setLabel('Generate New Account')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(true)
            );

        await interaction.message.edit({ components: [row] });

        const embed = new EmbedBuilder()
            .setTitle('Generate New Account')
            .setDescription('Choose how you want to generate the next account')
            .setColor(0x2B2D31);

        const row2 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`random_${interaction.user.id}`)
                    .setLabel('Random Account')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`specific_${interaction.user.id}`)
                    .setLabel('Specific Age')
                    .setStyle(ButtonStyle.Primary)
            );

        await interaction.reply({
            embeds: [embed],
            components: [row2],
            ephemeral: true
        });
    }

    if (interaction.isButton() && interaction.customId.startsWith('random_')) {
        const userId = interaction.customId.split('_')[1];
        if (userId !== interaction.user.id) {
            return interaction.reply({ content: 'Not your request.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const acc = await getRandomAccount(interaction.user.id);
        if (!acc) {
            const total = await getTotalStock(interaction.user.id);
            if (total === 0) {
                const globalTotal = await getTotalStockGlobal();
                if (globalTotal > 0) {
                    userViewedAccounts.delete(interaction.user.id);
                    return interaction.editReply({ 
                        content: 'You have seen all available accounts. Please try again.' 
                    });
                }
            }
            return interaction.editReply({ content: 'Out of stock.' });
        }

        if (!userViewedAccounts.has(interaction.user.id)) {
            userViewedAccounts.set(interaction.user.id, []);
        }
        userViewedAccounts.get(interaction.user.id).push(acc.username);

        try {
            const publicChannel = await client.channels.fetch(PUBLIC_CHANNEL_ID);
            
            const publicEmbed = new EmbedBuilder()
                .setTitle('Account Generated')
                .setColor(0x2B2D31)
                .setDescription('Review account details and click Keep This Account when ready')
                .addFields(
                    { name: 'Username', value: `\`${acc.username}\``, inline: false },
                    { name: 'Account Age', value: acc.birthdayAge || 'Unknown', inline: true },
                    { name: 'Created', value: formatCreatedDate(acc.created) || 'Unknown', inline: true }
                )
                .setFooter({ text: 'Requested: Random' });

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`keep_${acc.username}`)
                        .setLabel('Keep This Account')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`new_${interaction.user.id}`)
                        .setLabel('Generate New Account')
                        .setStyle(ButtonStyle.Primary)
                );

            await publicChannel.send({
                content: `New account generated by <@${interaction.user.id}>!`,
                embeds: [publicEmbed],
                components: [row]
            });

            await interaction.editReply({ content: `Account sent to <#${PUBLIC_CHANNEL_ID}>` });

        } catch (err) {
            console.error('Error:', err);
            await interaction.editReply({ content: 'Failed to send account.' });
        }
    }

    if (interaction.isButton() && interaction.customId.startsWith('specific_')) {
        const userId = interaction.customId.split('_')[1];
        if (userId !== interaction.user.id) {
            return interaction.reply({ content: 'Not your request.', ephemeral: true });
        }

        const modal = new ModalBuilder()
            .setCustomId(`age_modal_${interaction.user.id}`)
            .setTitle('Request Account');

        const input = new TextInputBuilder()
            .setCustomId('requested_age')
            .setLabel('Desired Account Age in Days')
            .setPlaceholder('Enter the age in days')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        await interaction.showModal(modal.addComponents(new ActionRowBuilder().addComponents(input)));
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('age_modal_')) {
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.customId.split('_')[2];
        if (userId !== interaction.user.id) {
            return interaction.editReply({ content: 'Not your request.' });
        }

        const input = interaction.fields.getTextInputValue('requested_age').trim();
        const requestedAge = parseInt(input);

        if (isNaN(requestedAge)) {
            return interaction.editReply({ content: 'Please enter a valid number.' });
        }

        const acc = await getSpecificAccount(requestedAge, interaction.user.id);
        if (!acc) {
            const total = await getTotalStock(interaction.user.id);
            if (total === 0) {
                const globalTotal = await getTotalStockGlobal();
                if (globalTotal > 0) {
                    userViewedAccounts.delete(interaction.user.id);
                    return interaction.editReply({ 
                        content: 'You have seen all available accounts. Please try again.' 
                    });
                }
            }
            return interaction.editReply({ content: 'No account found with that age.' });
        }

        if (!userViewedAccounts.has(interaction.user.id)) {
            userViewedAccounts.set(interaction.user.id, []);
        }
        userViewedAccounts.get(interaction.user.id).push(acc.username);

        try {
            const publicChannel = await client.channels.fetch(PUBLIC_CHANNEL_ID);
            
            const publicEmbed = new EmbedBuilder()
                .setTitle('Account Generated')
                .setColor(0x2B2D31)
                .setDescription('Review account details and click Keep This Account when ready')
                .addFields(
                    { name: 'Username', value: `\`${acc.username}\``, inline: false },
                    { name: 'Account Age', value: acc.birthdayAge || 'Unknown', inline: true },
                    { name: 'Created', value: formatCreatedDate(acc.created) || 'Unknown', inline: true }
                )
                .setFooter({ text: `Requested: ${requestedAge} days (closest match: ${formatCreatedDate(acc.created)})` });

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`keep_${acc.username}`)
                        .setLabel('Keep This Account')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`new_${interaction.user.id}`)
                        .setLabel('Generate New Account')
                        .setStyle(ButtonStyle.Primary)
                );

            await publicChannel.send({
                content: `New account generated by <@${interaction.user.id}>!`,
                embeds: [publicEmbed],
                components: [row]
            });

            await interaction.editReply({ content: `Account sent to <#${PUBLIC_CHANNEL_ID}>` });

        } catch (err) {
            console.error('Error:', err);
            await interaction.editReply({ content: 'Failed to send account.' });
        }
    }

    if (interaction.isButton() && interaction.customId.startsWith('keep_')) {
        const username = interaction.customId.split('_')[1];
        
        const content = interaction.message.content;
        const userId = content.match(/<@(\d+)>/);
        if (!userId || userId[1] !== interaction.user.id) {
            return interaction.reply({ content: 'You did not generate this account.', ephemeral: true });
        }

        const acc = await markAccountUsed(username);
        if (!acc) {
            return interaction.reply({ content: 'Account already taken.', ephemeral: true });
        }

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('keep_disabled')
                    .setLabel('Keep This Account')
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId('new_disabled')
                    .setLabel('Generate New Account')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(true)
            );

        await interaction.message.edit({ components: [row] });

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
                .setColor(0x2B2D31)
                .addFields(
                    { name: 'Username', value: `\`${acc.username}\``, inline: false },
                    { name: 'Password', value: `\`${acc.password}\``, inline: false },
                    { name: 'Account Age', value: acc.birthdayAge || 'Unknown', inline: true },
                    { name: 'Created', value: formatCreatedDate(acc.created) || 'Unknown', inline: true }
                )
                .setFooter({ text: 'Account claimed' });

            await channel.send({ content: `<@${interaction.user.id}>`, embeds: [embed] });
            await interaction.reply({ content: `Account sent to ${channel}`, ephemeral: true });

        } catch (err) {
            console.error('Error:', err);
            await interaction.reply({ content: 'Failed to create channel.', ephemeral: true });
        }
    }

    if (interaction.isButton() && (interaction.customId === 'keep_disabled' || interaction.customId === 'new_disabled')) {
        return interaction.reply({ content: 'This account has already been processed.', ephemeral: true });
    }
});

client.login(process.env.DISCORD_TOKEN);
