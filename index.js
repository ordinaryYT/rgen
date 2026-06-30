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
const { createClient } = require('@supabase/supabase-js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

const app = express();
app.get('/', (req, res) => res.send('Bot Online'));
app.listen(process.env.PORT || 3000);

setInterval(() => axios.get('https://rgen.onrender.com').catch(() => {}), 60000);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const COMMON_PASSWORD = process.env.ACCOUNT_PASSWORD;

async function initDB() {
    try {
        await supabase.from('specific').select('*').limit(0);
    } catch (e) {}
    try {
        await supabase.from('random').select('*').limit(0);
    } catch (e) {}
}

async function importStock() {
    await supabase.from('specific').delete().neq('username', 'x');
    await supabase.from('random').delete().neq('username', 'x');

    // specific.txt = username:age
    try {
        const data = fs.readFileSync('./specific.txt', 'utf8');
        const rows = data.split('\n').map(line => {
            const t = line.trim();
            if (!t) return null;
            const [username, ageStr] = t.split(':');
            return username ? { username: username.trim(), password: COMMON_PASSWORD, age: parseInt(ageStr) || 0 } : null;
        }).filter(Boolean);

        if (rows.length) await supabase.from('specific').insert(rows);
    } catch (e) {}

    // random.txt = username:age
    try {
        const data = fs.readFileSync('./random.txt', 'utf8');
        const rows = data.split('\n').map(line => {
            const t = line.trim();
            if (!t) return null;
            const [username, ageStr] = t.split(':');
            return username ? { username: username.trim(), password: COMMON_PASSWORD, age: parseInt(ageStr) || 0 } : null;
        }).filter(Boolean);

        if (rows.length) await supabase.from('random').insert(rows);
    } catch (e) {}
}

client.once('ready', async () => {
    console.log(`${client.user.tag} online`);
    await initDB();
    await importStock();

    const commands = [
        new SlashCommandBuilder()
            .setName('genpanel')
            .setDescription('Post the generator panel')
            .setDefaultMemberPermissions(8)
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
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

        if (isRandom) {
            const { data } = await supabase.from('random').select('*').limit(1);
            acc = data && data[0] ? data[0] : null;
            if (acc) await supabase.from('random').delete().eq('username', acc.username);
        } else {
            const { data } = await supabase.from('specific').select('*').order('age', { ascending: true }).limit(1);
            acc = data && data[0] ? data[0] : null;
            if (acc) await supabase.from('specific').delete().eq('username', acc.username);
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
