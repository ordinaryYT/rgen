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
    type: String, // 'old' or 'new'
    created: String,
    region: { type: String, default: 'Unknown' },
    used: { type: Boolean, default: false }
});

const Account = mongoose.model('Account', AccountSchema);

const COMMON_PASSWORD = process.env.ACCOUNT_PASSWORD;
const PUBLIC_CHANNEL_ID = process.env.PUBLIC_CHANNEL_ID;

// Store current preview account per user
const userPreviews = new Map();

async function importStock() {
    // Clear old unused accounts
    await Account.deleteMany({ used: false });

    // OLD STOCK: username:age (uses env password)
    try {
        const data = fs.readFileSync('./specific.txt', 'utf8');
        const rows = data.split('\n').map(line => {
            const t = line.trim();
            if (!t) return null;
            const [username, ageStr] = t.split(':');
            return username ? { 
                username: username.trim(), 
                password: COMMON_PASSWORD, 
                age: parseInt(ageStr) || 0, 
                type: 'old',
                created: 'Unknown',
                region: 'Unknown',
                used: false 
            } : null;
        }).filter(Boolean);

        if (rows.length) {
            for (let row of rows) {
                const exists = await Account.findOne({ username: row.username });
                if (!exists) {
                    await Account.create(row);
                }
            }
        }
        console.log(`✅ Imported ${rows.length} old accounts`);
    } catch (e) {
        console.log('No specific.txt found');
    }

    // NEW STOCK: username:password:age:created
    try {
        const data = fs.readFileSync('./accounts.txt', 'utf8');
        const rows = data.split('\n').map(line => {
            const t = line.trim();
            if (!t) return null;
            const parts = t.split(':');
            if (parts.length >= 4) {
                const age = parseInt(parts[2]) || 0;
                let created = parts[3].trim() || 'Unknown';
                return {
                    username: parts[0].trim(),
                    password: parts[1].trim(),
                    age: age,
                    created: created,
                    type: 'new',
                    region: 'United States',
                    used: false
                };
            }
            return null;
        }).filter(Boolean);

        if (rows.length) {
            for (let row of rows) {
                const exists = await Account.findOne({ username: row.username });
                if (!exists) {
                    await Account.create(row);
                }
            }
        }
        console.log(`✅ Imported ${rows.length} new accounts`);
    } catch (e) {
        console.log('No accounts.txt found');
    }
}

async function getRandomAccount() {
    const acc = await Account.findOne({ used: false });
    if (acc) {
        acc.used = true;
        await acc.save();
        return acc;
    }
    return null;
}

async function getSpecificAccount(requestedAge) {
    const accounts = await Account.find({ used: false });
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

async function getPreviewAccount() {
    const acc = await Account.findOne({ used: false });
    if (!acc) return null;
    return acc;
}

async function getTotalStock() {
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
        
        const total = await getTotalStock();
        console.log(`📊 ${total} accounts available`);
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
        const total = await getTotalStock();
        const embed = new EmbedBuilder()
            .setTitle('🔍 Browse Accounts')
            .setDescription(`Click the button below to start browsing accounts\n\n**${total} accounts available**`)
            .setColor('Blurple');

        const button = new ButtonBuilder()
            .setCustomId('browse_accounts')
            .setLabel('Browse Accounts')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🔍');

        await interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] });
    }

    if (interaction.isButton() && interaction.customId === 'browse_accounts') {
        const total = await getTotalStock();
        if (total === 0) {
            return interaction.reply({ content: 'Out of stock.', ephemeral: true });
        }

        const acc = await getPreviewAccount();
        if (!acc) {
            return interaction.reply({ content: 'Out of stock.', ephemeral: true });
        }

        userPreviews.set(interaction.user.id, acc);

        const embed = new EmbedBuilder()
            .setTitle('🔍 Browse Accounts')
            .setDescription('Review account details and click Generate This Account when ready')
            .setColor('Blurple')
            .addFields(
                { name: 'Username', value: `\`${acc.username}\``, inline: true },
                { name: 'User ID', value: `\`${Math.floor(Math.random() * 10000000000)}\``, inline: true },
                { name: 'Region', value: acc.region || 'United States', inline: true },
                { name: 'Created', value: acc.created || 'Unknown', inline: true },
                { name: 'Account Age', value: `${acc.age} days`, inline: true },
                { name: 'Last Online', value: 'Offline', inline: true }
            )
            .setFooter({ text: `Showing account 1 of ${total}` });

        const row1 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('prev_account')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId('pick_account')
                    .setLabel('Generate This Account')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId('next_account')
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Primary)
            );

        const row2 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('back_options')
                    .setLabel('Back to Options')
                    .setStyle(ButtonStyle.Secondary)
            );

        await interaction.reply({ 
            embeds: [embed], 
            components: [row1, row2],
            ephemeral: true
        });
    }

    if (interaction.isButton() && interaction.customId === 'next_account') {
        const total = await getTotalStock();
        const acc = await getPreviewAccount();
        if (!acc) {
            return interaction.update({ content: 'Out of stock.', embeds: [], components: [] });
        }

        userPreviews.set(interaction.user.id, acc);

        const pageNum = Math.floor(Math.random() * total) + 1;

        const embed = new EmbedBuilder()
            .setTitle('🔍 Browse Accounts')
            .setDescription('Review account details and click Generate This Account when ready')
            .setColor('Blurple')
            .addFields(
                { name: 'Username', value: `\`${acc.username}\``, inline: true },
                { name: 'User ID', value: `\`${Math.floor(Math.random() * 10000000000)}\``, inline: true },
                { name: 'Region', value: acc.region || 'United States', inline: true },
                { name: 'Created', value: acc.created || 'Unknown', inline: true },
                { name: 'Account Age', value: `${acc.age} days`, inline: true },
                { name: 'Last Online', value: 'Offline', inline: true }
            )
            .setFooter({ text: `Showing account ${pageNum} of ${total}` });

        const row1 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('prev_account')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId('pick_account')
                    .setLabel('Generate This Account')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId('next_account')
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Primary)
            );

        const row2 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('back_options')
                    .setLabel('Back to Options')
                    .setStyle(ButtonStyle.Secondary)
            );

        await interaction.update({ embeds: [embed], components: [row1, row2] });
    }

    if (interaction.isButton() && interaction.customId === 'pick_account') {
        const acc = userPreviews.get(interaction.user.id);
        if (!acc) {
            return interaction.reply({ content: 'No account selected.', ephemeral: true });
        }

        const dbAcc = await Account.findOne({ username: acc.username, used: false });
        if (!dbAcc) {
            userPreviews.delete(interaction.user.id);
            return interaction.update({ content: 'Account already taken.', embeds: [], components: [] });
        }

        dbAcc.used = true;
        await dbAcc.save();
        userPreviews.delete(interaction.user.id);

        await interaction.update({ content: '✅ Generating account...', embeds: [], components: [] });

        try {
            const publicChannel = await client.channels.fetch(PUBLIC_CHANNEL_ID);
            
            const publicEmbed = new EmbedBuilder()
                .setTitle('🎮 Account Generated')
                .setColor('Green')
                .addFields(
                    { name: 'Username', value: `\`${dbAcc.username}\``, inline: true },
                    { name: 'User ID', value: `\`${Math.floor(Math.random() * 10000000000)}\``, inline: true },
                    { name: 'Region', value: dbAcc.region || 'United States', inline: true },
                    { name: 'Created', value: dbAcc.created || 'Unknown', inline: true },
                    { name: 'Account Age', value: `${dbAcc.age} days`, inline: true },
                    { name: 'Last Online', value: 'Offline', inline: true }
                )
                .setFooter({ text: 'Click the button below to claim this account' });

            const claimButton = new ButtonBuilder()
                .setCustomId(`claim_${dbAcc._id}`)
                .setLabel('Claim This Account')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🔑');

            await publicChannel.send({
                content: `🎉 New account generated!`,
                embeds: [publicEmbed],
                components: [new ActionRowBuilder().addComponents(claimButton)]
            });

            await interaction.followUp({ content: `✅ Account sent to <#${PUBLIC_CHANNEL_ID}>`, ephemeral: true });

        } catch (err) {
            console.error('Error:', err);
            await interaction.followUp({ content: 'Failed to send account.', ephemeral: true });
        }
    }

    if (interaction.isButton() && interaction.customId.startsWith('claim_')) {
        const accountId = interaction.customId.split('_')[1];
        const acc = await Account.findById(accountId);
        
        if (!acc) {
            return interaction.reply({ content: 'Account not found.', ephemeral: true });
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
                .addFields(
                    { name: 'Username', value: `\`${acc.username}\``, inline: true },
                    { name: 'Password', value: `\`${acc.password}\``, inline: true },
                    { name: 'User ID', value: `\`${Math.floor(Math.random() * 10000000000)}\``, inline: true },
                    { name: 'Region', value: acc.region || 'United States', inline: true },
                    { name: 'Created', value: acc.created || 'Unknown', inline: true },
                    { name: 'Account Age', value: `${acc.age} days`, inline: true },
                    { name: 'Last Online', value: 'Offline', inline: true }
                );

            await channel.send({ content: `<@${interaction.user.id}>`, embeds: [embed] });
            await interaction.reply({ content: `✅ Account sent to ${channel}`, ephemeral: true });

        } catch (err) {
            console.error('Error:', err);
            await interaction.reply({ content: 'Failed to create channel.', ephemeral: true });
        }
    }

    if (interaction.isButton() && interaction.customId === 'back_options') {
        const total = await getTotalStock();
        const embed = new EmbedBuilder()
            .setTitle('🔍 Browse Accounts')
            .setDescription(`Click the button below to start browsing accounts\n\n**${total} accounts available**`)
            .setColor('Blurple');

        const button = new ButtonBuilder()
            .setCustomId('browse_accounts')
            .setLabel('Browse Accounts')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🔍');

        await interaction.update({ embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] });
    }

    if (interaction.isButton() && interaction.customId === 'prev_account') {
        // Previous button is disabled in this version
        await interaction.reply({ content: 'No previous account.', ephemeral: true });
    }
});

client.login(process.env.DISCORD_TOKEN);
