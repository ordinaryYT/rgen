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
    created: String,
    used: { type: Boolean, default: false }
});

const Account = mongoose.model('Account', AccountSchema);

const PUBLIC_CHANNEL_ID = process.env.PUBLIC_CHANNEL_ID;

async function importStock() {
    await Account.deleteMany({});

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
                    age: parseInt(parts[2]) || 0,
                    created: parts[3].trim() || 'Unknown',
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
        console.log(`Imported ${rows.length} accounts`);
    } catch (e) {
        console.log('No accounts.txt found');
    }
}

async function getRandomAccount() {
    const acc = await Account.findOne({ used: false });
    return acc || null;
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
    // GENPANEL COMMAND
    if (interaction.isChatInputCommand() && interaction.commandName === 'genpanel') {
        const total = await getTotalStock();
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

    // GENERATE ACCOUNT BUTTON - Opens modal
    if (interaction.isButton() && interaction.customId === 'generate_account') {
        const total = await getTotalStock();
        if (total === 0) {
            return interaction.reply({ content: 'Out of stock.', ephemeral: true });
        }

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

    // MODAL SUBMIT
    if (interaction.isModalSubmit() && interaction.customId === 'age_modal') {
        await interaction.deferReply({ ephemeral: true });

        const input = interaction.fields.getTextInputValue('requested_age').trim();
        const requestedAge = input ? parseInt(input) : NaN;
        const isRandom = isNaN(requestedAge);

        let acc;
        if (isRandom) {
            acc = await getRandomAccount();
        } else {
            acc = await getSpecificAccount(requestedAge);
        }

        if (!acc) {
            return interaction.editReply({ content: 'Out of stock.' });
        }

        try {
            const publicChannel = await client.channels.fetch(PUBLIC_CHANNEL_ID);
            
            const publicEmbed = new EmbedBuilder()
                .setTitle('Account Generated')
                .setColor('Blue')
                .addFields(
                    { name: 'Username', value: `\`${acc.username}\``, inline: true },
                    { name: 'Account Age', value: `${acc.age} days`, inline: true },
                    { name: 'Created', value: acc.created || 'Unknown', inline: true }
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

    // GENERATE NEW ACCOUNT BUTTON
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
            .setColor('Blurple');

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

    // RANDOM ACCOUNT BUTTON
    if (interaction.isButton() && interaction.customId.startsWith('random_')) {
        const userId = interaction.customId.split('_')[1];
        if (userId !== interaction.user.id) {
            return interaction.reply({ content: 'Not your request.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const acc = await getRandomAccount();
        if (!acc) {
            return interaction.editReply({ content: 'Out of stock.' });
        }

        try {
            const publicChannel = await client.channels.fetch(PUBLIC_CHANNEL_ID);
            
            const publicEmbed = new EmbedBuilder()
                .setTitle('Account Generated')
                .setColor('Blue')
                .addFields(
                    { name: 'Username', value: `\`${acc.username}\``, inline: true },
                    { name: 'Account Age', value: `${acc.age} days`, inline: true },
                    { name: 'Created', value: acc.created || 'Unknown', inline: true }
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

    // SPECIFIC AGE BUTTON
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
            .setLabel('Desired Age in Days')
            .setPlaceholder('Enter the age in days')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        await interaction.showModal(modal.addComponents(new ActionRowBuilder().addComponents(input)));
    }

    // SPECIFIC AGE MODAL SUBMIT
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

        const acc = await getSpecificAccount(requestedAge);
        if (!acc) {
            return interaction.editReply({ content: 'No account found with that age.' });
        }

        try {
            const publicChannel = await client.channels.fetch(PUBLIC_CHANNEL_ID);
            
            const publicEmbed = new EmbedBuilder()
                .setTitle('Account Generated')
                .setColor('Blue')
                .addFields(
                    { name: 'Username', value: `\`${acc.username}\``, inline: true },
                    { name: 'Account Age', value: `${acc.age} days`, inline: true },
                    { name: 'Created', value: acc.created || 'Unknown', inline: true }
                )
                .setFooter({ text: `Requested: ${requestedAge} days (closest match: ${acc.age} days)` });

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

    // KEEP ACCOUNT BUTTON
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
                .setColor('Blue')
                .addFields(
                    { name: 'Username', value: `\`${acc.username}\``, inline: true },
                    { name: 'Password', value: `\`${acc.password}\``, inline: true },
                    { name: 'Account Age', value: `${acc.age} days`, inline: true },
                    { name: 'Created', value: acc.created || 'Unknown', inline: true }
                )
                .setFooter({ text: 'Account claimed' });

            await channel.send({ content: `<@${interaction.user.id}>`, embeds: [embed] });
            await interaction.reply({ content: `Account sent to ${channel}`, ephemeral: true });

        } catch (err) {
            console.error('Error:', err);
            await interaction.reply({ content: 'Failed to create channel.', ephemeral: true });
        }
    }

    // Disabled button handlers
    if (interaction.isButton() && (interaction.customId === 'keep_disabled' || interaction.customId === 'new_disabled')) {
        return interaction.reply({ content: 'This account has already been processed.', ephemeral: true });
    }
});

client.login(process.env.DISCORD_TOKEN);
