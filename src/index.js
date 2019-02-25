const Eris = require("eris");
const mongoose = require("mongoose");
const TOML = require("toml");
const { join } = require("path");
const fs = require("fs");

global.Promise = require("bluebird");
mongoose.Promise = global.Promise;

 const Violation = new mongoose.Schema({
     "id": String,
     "timestamp": String,
     "by": String,
     "reason": String
 });

const User = new mongoose.Schema({
    "id": String,
    "isBanned": Boolean,
    "warns": [Violation],
    "bans": [Violation],
    "kicks": [Violation]
});

const GuildSchema = new mongoose.Schema({
    "id": String,
    "logChannel": String,
    "users": [User]
});

const Guild = mongoose.model("Guild", GuildSchema);

const toml = fs.readFileSync(join(__dirname, "..", "config.toml"));
const config = TOML.parse(toml);
config.embedColor = parseInt(config.embedColor, 16);

let ready = false;
let commands = {};

const cmdDir = fs.readdirSync(join(__dirname, "commands"));
for (let i = 0; i < cmdDir.length; i++) {
    const file = cmdDir[i];
    if (file.endsWith(".js")) {
        const command = new (require(`./commands/${file}`))();
        commands[command.name] = command;
    }
}

const client = new Eris.Client(config.token, {
    getAllUsers: true
});

 /**
 * Main function to handle all commands
 * @param {Eris.Message} msg
 * @param {boolean} dm
 */
async function handleCommand(msg, dm) {
    const parts = msg.content.split(" ");
    const command = parts[0].slice(config.prefix.length);

    if (!commands[command]) return; // Command doesn't exist

    // Let the user know the command can only be run in a guild
    if (commands[command].guildOnly && dm) {
        try {
            await msg.channel.createMessage(`The command \`${command}\` can only be run in a guild.`);
        } catch (error) {
            console.error(error);
        }
        return;
    }

    const args = parts.splice(1);
    const context = {
        config,
        commands,
        database: {
            guild: Guild
        }
    };

    if (commands[command].requiredArgs > args.length) {
        try {
            return await msg.channel.createMessage(`This command requires atleast ${commands[command].requiredArgs} arguments`);
        } catch (e) {
            return;
        }
    }

    // Only check for permission if the command is used in a guild
    if (msg.channel.guild) {
        const botPermissions = commands[command].botPermissions;
        if (botPermissions.length > 0) {
            const member = msg.channel.guild.members.get(client.user.id);
            let missingPermissions = [];
            for (let i = 0; i < botPermissions.length; i++) {
                const hasPermission = member.permission.has(botPermissions[i]);
                if (hasPermission === false) {
                    missingPermissions.push(`**${botPermissions[i]}**`);
                }
            }

            if (missingPermissions.length > 0) {
                try {
                    return await msg.channel.createMessage(`The bot is missing these required permissions: ${missingPermissions.join(", ")}`);
                } catch (e) {
                    return;
                }
            }
        }

        const userPermissions = commands[command].userPermissions;
        if (userPermissions.length > 0) {
            const member = msg.channel.guild.members.get(msg.author.id);
            let missingPermissions = [];
            for (let i = 0; i < userPermissions.length; i++) {
                const hasPermission = member.permission.has(userPermissions[i]);
                if (hasPermission === false) {
                    missingPermissions.push(`**${userPermissions[i]}**`);
                }
            }

            if (missingPermissions.length > 0) {
                return await msg.channel.createMessage(`You are missing these required permissions: ${missingPermissions.join(", ")}`);
            }
        }
    }

    if (commands[command].ownerOnly && msg.author.id !== config.owner) {
        try {
            await msg.channel.createMessage("Only the owner can execute this command.");
        } catch (e) {} // eslint-disable-line no-empty

        return;
    }

    try {
        await commands[command].run(msg, args, client, context);
    } catch (error) {
        try {
            await msg.channel.createMessage({
                embed: {
                    color: 0xDC143C,
                    description: error.toString()
                }
            });
        } catch (e) {
            console.error(e);
        }
    }
}

client.on("ready", async () => {
    await mongoose.connect(`mongodb://${config.database.host}:${config.database.port}/${config.database.name}`, { useNewUrlParser: true });
    console.log("Ready!");
    ready = true;
});

client.on("messageCreate", async (msg) => {
    if (!ready) return; // Bot not ready yet
    if (!msg.author) return; // Probably system message
    if (msg.author.discriminator === "0000") return; // Probably a webhook

    if (msg.content.startsWith(config.prefix)) {
        if (!msg.channel.guild && msg.author.id !== client.user.id) {
            await handleCommand(msg, true);
        } else if (msg.channel.guild) {
            await handleCommand(msg, false);
        }
    }
});

client.on("guildCreate", async (guild) => {
    const newGuild = new Guild({ "id": guild.id, "logChannel": "" });
    await newGuild.save();
});

client.connect().catch(console.error);
