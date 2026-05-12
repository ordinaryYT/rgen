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

// ROLE THAT CAN USE /RESTOCK
const RESTOCK_ROLE_ID = 'PUT_ROLE_ID_HERE';

// ACCOUNT STOCK
const stock = {
    'alt': [],
    '+30 days old': [],
    '+1 year old': [],
    '5+ years old': [],
    'dump': []
};

// REGISTER COMMANDS
client.once('ready', async () => {

    console.log(`${client.user.tag} online`);

    const commands = [

        new SlashCommandBuilder()
            .setName('gen')
            .setDescription('Generate a Roblox account')
            .addStringOption(option =>
                option
                    .setName('type')
                    .setDescription('Account type')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Alt', value: 'alt' },
                        { name: '30 Days Old', value: '+30 days old' },
                        { name: '1 Year Old', value: '+1 year old' },
                        { name: '5+ Years Old', value: '5+ years old' },
                        { name: 'Dump', value: 'dump' }
                    )
            ),

        new SlashCommandBuilder()
            .setName('stock')
            .setDescription('View stock'),

        new SlashCommandBuilder()
            .setName('restock')
            .setDescription('Generate 10 accounts')
            .addStringOption(option =>
                option
                    .setName('type')
                    .setDescription('Account type')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Alt', value: 'alt' },
                        { name: '30 Days Old', value: '+30 days old' },
                        { name: '1 Year Old', value: '+1 year old' },
                        { name: '5+ Years Old', value: '5+ years old' },
                        { name: 'Dump', value: 'dump' }
                    )
            )

    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: '10' })
        .setToken(process.env.DISCORD_TOKEN);

    await rest.put(
        Routes.applicationCommands(client.user.id),
        { body: commands }
    );

    console.log('Slash commands registered');
});

// COMMAND HANDLER
client.on('interactionCreate', async (interaction) => {

    if (!interaction.isChatInputCommand()) return;

    // STOCK
    if (interaction.commandName === 'stock') {

        return interaction.reply({
            content:
                '```' +
                '\n📦 BLOXGEN STOCK' +
                '\n━━━━━━━━━━━━━━━━━━' +
                `\nAlt: ${stock['alt'].length}` +
                `\n30 Days Old: ${stock['+30 days old'].length}` +
                `\n1 Year Old: ${stock['+1 year old'].length}` +
                `\n5+ Years Old: ${stock['5+ years old'].length}` +
                `\nDump: ${stock['dump'].length}` +
                '\n━━━━━━━━━━━━━━━━━━' +
                '```'
        });
    }

    // GENERATE
    if (interaction.commandName === 'gen') {

        const type = interaction.options.getString('type');

        if (stock[type].length <= 0) {

            return interaction.reply({
                content: `❌ ${type} stock empty.`,
                ephemeral: true
            });
        }

        const acc = stock[type].shift();

        try {

            await interaction.user.send(
                '```' +
                `\nTYPE: ${type}` +
                `\nUSERNAME: ${acc.username}` +
                `\nPASSWORD: ${acc.password}` +
                '\n```'
            );

            return interaction.reply({
                content: '✅ Account sent to your DMs.',
                ephemeral: true
            });

        } catch {

            return interaction.reply({
                content: '❌ Enable DMs first.',
                ephemeral: true
            });
        }
    }

    // RESTOCK
    if (interaction.commandName === 'restock') {

        if (!interaction.member.roles.cache.has(RESTOCK_ROLE_ID)) {

            return interaction.reply({
                content: '❌ No permission.',
                ephemeral: true
            });
        }

        const type = interaction.options.getString('type');

        await interaction.reply(
            `🔄 Restocking ${type} accounts...`
        );

        let success = 0;

        for (let i = 0; i < 10; i++) {

            try {

                const response = await axios.post(
                    'https://core.bloxgen.net/api/generate',
                    {
                        apiKey: process.env.BLOXGEN_API_KEY,
                        type: type
                    }
                );

                const data = response.data;

                stock[type].push({
                    username: data.username,
                    password: data.password
                });

                success++;

            } catch (err) {

                console.log(
                    err.response?.data || err.message
                );
            }
        }

        interaction.editReply(
            `✅ Added ${success} ${type} accounts to stock.`
        );
    }
});

client.login(process.env.DISCORD_TOKEN);
