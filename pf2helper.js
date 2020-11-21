Hooks.once('init', () => {
    console.log('init hook');
});

Hooks.once('canvasReady', () => {

    console.log('ready hook');
    game.pf2_helper = new PF2Helper();


});

var skill_lookup = {
    "aberration" : ['occultism'],
    "animal"     : ['nature'],
    "astral"     : ['occultism'],
    "beast"      : ['arcana','nature'],
    "celestial"  : ['religion'],
    "construct"  : ['arcana','crafting'],
    "dragon"     : ['arcana'],
    "elemental"  : ['arcana','nature'],
    "ethereal"   : ['occultism'],
    "fey"        : ['nature'],
    "fiend"      : ['religion'],
    "fungus"     : ['nature'],
    "humanoid"   : ['society'],
    "monitor"    : ['religion'],
    "ooze"       : ['occultism'],
    "plant"      : ['nature'],
    "spirit"     : ['occultism'],
    "undead"     : ['religion'],
}

var dc_adjust = {
    'none' : 0,
    'incredibly-easy' : -10,
    'very-easy' : -5,
    'easy' : -2,
    'hard' : +2,
    'very-hard' : +5,
    'incredibly-hard' : +10,
};

var level_dcs = [14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34, 35, 36, 38, 39, 40, 42, 44, 46, 48, 50];

async function update_token(token) {
    console.log(token.actor.data.data.token_num);
    if( token.actor.data.data.token_num > 0 ) {
        let token_num = token.actor.data.data.token_num;
        let icon = `common/numbers/${token_num}.png`;
        if( !token.data.effects.includes(icon) ) {
            await token.toggleEffect(icon);
        }
    }

    // What about used reactions?
    let icon = 'common/Reaction.png';
    let really_used = token.actor.data.data.reaction_used;

    if( really_used == undefined || really_used == null ) {
        really_used = false;
    }
    if( really_used != token.data.effects.includes(icon) ) {
        await token.toggleEffect(icon);
    }

    if( has_courage(token) ) {
        console.log(`Setting courage on ${token.name}`);
        let icon = "systems/pf2e/icons/conditions-2/status_hero.png";
        if (!token.data.effects.includes(icon)) {
            await token.toggleEffect(icon)
        }
        // else {
        //     // A simple refresh for everyone
        //     console.log('Refresh');
        //     token.update({effects:token.data.effects});
        // }
    }
}

function pathfinder_distance(src, dst) {
    // Distance in pathfinder is weird.
    let diff_x = Math.abs(src.x - dst.x);
    let diff_y = Math.abs(src.y - dst.y);

    let diff_small = diff_x < diff_y ? diff_x : diff_y;
    let diff_big   = diff_x < diff_y ? diff_y : diff_x;

    return Math.floor(diff_small * 1.5) + (diff_big - diff_small);
}

function has_courage(token) {
    if( !token || !token.actor || !token.actor.data.data.customModifiers ) {
        return false;
    }
    return ((token.actor.data.data.customModifiers['attack'] || []).
            some(modifier => modifier.name === 'Inspire Courage'));
}

function has_know_weakness(token) {
    if( !token || !token.actor || !token.actor.data.data.customModifiers ) {
        return false;
    }
    return ((token.actor.data.data.customModifiers['attack'] || []).
            some(modifier => modifier.name === 'Know Weakness'));
}

async function enable_inspire_courage(token) {
    let messageContent = '';
    let actor = token.actor;
    if(has_courage(token)) {
        return;
    }
    await actor.addCustomModifier('attack', 'Inspire Courage', 1, 'status');
    await actor.addCustomModifier('damage', 'Inspire Courage', 1, 'status');
    let icon = "systems/pf2e/icons/conditions-2/status_hero.png";
    if (!token.data.effects.includes(icon)) {
        token.toggleEffect(icon)
    }
}

async function disable_inspire_courage(token) {
    let messageContent = '';
    let actor = token.actor;
    if(!has_courage(token)) {
        return;
    }
    await actor.removeCustomModifier('attack', 'Inspire Courage');
    await actor.removeCustomModifier('damage', 'Inspire Courage');

    let icon = "systems/pf2e/icons/conditions-2/status_hero.png";

    if (token.data.effects.includes(icon)) {
        token.toggleEffect(icon)
    }
}

async function disable_all_inspire_courage(token) {
    for (let target_token of canvas.tokens.objects.children) {
        if( target_token.data.disposition == token.data.disposition ) {
            await disable_inspire_courage(target_token);
        }
    }
}

function choose(choices) {
  var index = Math.floor(Math.random() * choices.length);
  return choices[index];
}

class PF2Helper {

    constructor() {
        this.playing = false;
        this.bruce_sounds = ['born.ogg','fire1.ogg','fire2.ogg','young.ogg','young2.ogg'];
        this.bruce_index = Math.floor(Math.random() * this.bruce_sounds.length);
        this.stratagems = {};
        this.known_crits = {};
        this.current_knower = null;
        // In 0.7.7 it looks like the combat has stopped showing previous correctly. In order to be able to
        // catch things like adding people to initiative and ending turns correctly, I'll keep track of the
        // current combat info myself
        this.combat = {round : -1,
                       turn : -1,
                       num_tokens : 0,
                       last_token : null,
                      };
        Hooks.on('diceSoNiceRollComplete', this.handle_roll.bind(this));
        game.socket.on('module.pf2helper', (request) => {
            let token = null;
            if( request.data.token_id ) {
                token = canvas.tokens.objects.children.find( t => t.id == request.data.token_id );
            }

            if( request.data.type == 'inspire' ) {

                if( request.data.sound ) {
                    this.bruce_index = request.data.bruce_index;
                    this.play('sfx/bruce/' + request.data.sound);
                }
                if( game.user.isGM ) {
                    this.inspire_courage(request.data.actor, token, false);
                }
            }
            else if( request.data.type == 'recall' ) {
                if( game.user.isGM ) {
                    let target = null;
                    if( request.data.target_id ) {
                        target = canvas.tokens.objects.children.find( t => t.id == request.data.target_id );
                    }
                    this.recall_knowledge(token, target, request.data.known_weakness);
                }
            }
        });
        Hooks.on('createCombat', this.create_combat.bind(this));
        if( !game.user.isGM ) {
            return;
        }
        Hooks.on('updateCombat', this.handle_combat.bind(this));
        Hooks.on("canvasReady", this.handle_scene.bind(this));
        Hooks.on('createChatMessage', this.handle_chat.bind(this));

        this.handle_scene();
    }

    async handle_scene() {
        //for(var actor of Object.keys(game.actors.tokens)) {
        for (let token of canvas.tokens.objects.children) {
            await update_token(token);
        }
    }

    async handle_chat(message) {
        // Right now all we want to do on chat messages is see if a swashbuckler has used a finisher, and turn
        // off their panache if so
        //TODO: This
        return;
        // console.log(message);
        // if(message.data.flavor.indexOf('Finisher +') == -1) {
        //     return;
        // }
        // let actor_id = message.data.speaker.actor
        // console.log
    }

    get_bruce_sound() {
        let out = this.bruce_sounds[this.bruce_index];
        this.bruce_index = (this.bruce_index + 1) % this.bruce_sounds.length;
        return out;
    }

    async inspire_courage(actor, token, from_click=true) {
        console.log('***Inspire Courage!***');

        if( from_click ) {
            let sound = null;
            if( !has_courage(token) ) {
                sound = this.get_bruce_sound();
                this.play('sfx/bruce/' + sound);
            }

            game.socket.emit('module.pf2helper', {
                data : {
                    type:'inspire',
                    token_id:token ? token.id : null,
                    actor_id:actor ? actor.id : null,
                    sound : sound,
                    bruce_index : this.bruce_index,
                }
            });
        }
        if( !game.user.isGM ) {
            return;
        }

        // If it's already on, turn it off for everyone
        if( has_courage(token) ) {
            await disable_all_inspire_courage(token)
            return;
        }

        let grid_size = canvas.grid.size;
        let grid_pos = {x:token.x / grid_size,
                        y:token.y / grid_size};

        for (let target_token of canvas.tokens.objects.children) {
            let target_pos = {x : target_token.x / grid_size,
                              y : target_token.y / grid_size};
            let distance = pathfinder_distance(grid_pos, target_pos);
            if( distance <= 12 && target_token.data.disposition >= 1 ) {
                console.log('bingo');
                await enable_inspire_courage(target_token);
            }
        }
    }

    async enable_known_weakness(actor, token) {
        for (let target_token of canvas.tokens.objects.children) {
             if( target_token.data.disposition >= 1 ) {
                 if( !target_token.actor || has_know_weakness(target_token) ) {
                     continue;
                 }

                 await target_token.actor.addCustomModifier('attack', 'Know Weakness', 1, 'circumstance');
                 let icon = "systems/pf2e/icons/conditions-2/status_powerup.png";
                 if (!target_token.data.effects.includes(icon)) {
                     target_token.toggleEffect(icon)
                 }
            }
        }
    }

    async disable_known_weakness(token) {
        let messageContent = '';
        let actor = token.actor;
        if(!has_know_weakness(token)) {
            return;
        }
        await actor.removeCustomModifier('attack', 'Know Weakness');

        let icon = "systems/pf2e/icons/conditions-2/status_powerup.png";

        if (token.data.effects.includes(icon)) {
            token.toggleEffect(icon)
        }
    }


    devise_stratagem(actor, token, result, message_id) {
        // we receive this call as soon as the chat message has been created, but we need to wait until the 3D
        // dice have finished before doing anything, so we just record the id and let the handle_roll function
        // deal with it when it comes in
        console.log(`got new stratagem with id ${message_id}`);
        this.stratagems[message_id] = {actor : actor, token : token, result : result};
    }

    create_combat(combat) {
        this.play('sfx/roll_for_initiative.mp3');
        // reset everyone's reaction indicator just in case one was left on
        if( !game.user.isGM ) {
            return;
        }
        for (let token of canvas.tokens.objects.children) {
            //let token = game.actors.tokens[actor].token;
            if( token.actor.data.data.reaction_used ) {
                token.actor.update({'data.reaction_used':false});
                token.actor.data.data.reaction_used = false;
                update_token(token);
            }
        }
    }

    async start_turn(token) {
        if( token.actor.data.data.reaction_used ) {
            token.actor.update({'data.reaction_used':false});
            token.actor.data.data.reaction_used = false;
            update_token(token);
        }
        if( token.actor.name.startsWith('Bruce ') ) {
            // On Bruce's turn Inspire courage ends. TODO: Lingering composition. We probably want a duration
            // recorded on this and to simply decrement it here.
            await disable_all_inspire_courage(token);
        }
        if( this.current_knower == null || (this.current_knower && token.actor == this.current_knower) ) {
            this.current_knower = null;
            for (let target_token of canvas.tokens.objects.children) {
                this.disable_known_weakness(target_token);
            }
        }
    }

    async end_turn(token) {
        let actor = token.actor;

        if( !actor ) {
            return;
        }

        await this.disable_stratagem(actor, token);

        if( !actor.data || !actor.data.items ) {
            return;
        }

        let items = actor.data.items;

        // decrease any frightened on the token by 1
        for(let i = 0; i < items.length; i++) {

            if( items[i].type != 'condition' ) {
                continue;
            }

            if( items[i].name == 'Frightened' ) {
                token.statusEffectChanged = true;
                await PF2eConditionManager.updateConditionValue(items[i]._id, token, items[i].data.value.value - 1);
            }

            if( items[i].name == 'Persistent Damage' ) {
                await ChatMessage.create({
                    speaker: {actor:actor},
                    content: `<b>${actor.name} has persistent damage!</b>`,
                })
            }
        }
    }

    async handle_combat(combat, update, options, user_id) {
        if( !game.user.isGM || !combat || !combat.current || combat.turn < 0 ) {
            return;
        }
        if( this.combat.num_tokens != combat.turns.length ) {
            //this is presumably an update with new players or some dead or something
            this.combat.round = combat.current.round;
            this.combat.turn = combat.current.turn;
            this.combat.num_tokens = combat.turns.length;
            return;
        }
        if( this.combat.turn == combat.current.turn ) {
            // Why did this happen?
            return;
        }
        if( this.combat.last_token ) {
            let last_token = canvas.tokens.objects.children.find(token => token.id == this.combat.last_token);
            if( last_token ) {
                //console.log(`End turn on ${last_token.name}`);
                await this.end_turn(last_token);
            }
        }
        this.combat.round = combat.current.round;
        this.combat.turn = combat.current.turn;
        this.combat.last_token = combat.current.tokenId;

        // Next up, get the token correctly for players, and disable inspire courage on Bruce's turn
        if( combat.current && combat.current.round >= 1 && combat.current.tokenId ) {
            let token = canvas.tokens.objects.children.find(token => token.id == combat.current.tokenId)
            if( token ) {
                //console.log(`Start turn on ${token.name}`)
                await this.start_turn(token);
            }
        }
    }

    async enable_stratagem(message, actor, token, result) {
        // The first thing will be to put that icon on the token. It's not trivial to do it in the macro
        // because of the hook requirement

        // TODO: Make proper icons for devise a stratagem
        let icon = `common/numbers/${result}.png`;

        if( !token.data.effects.includes(icon) ) {
            await token.toggleEffect(icon);
        }

        await actor.setFlag('pf2helper','stratagem',result);
        await actor.unsetFlag('pf2helper','devising');
    }

    async disable_stratagem(actor, token) {
        let result = actor.getFlag('pf2helper','stratagem');

        let icon = `common/numbers/${result}.png`;

        if( token.data.effects.includes(icon) ) {
            await token.toggleEffect(icon);
        }

        await actor.unsetFlag('pf2helper','stratagem');
        await actor.unsetFlag('pf2helper','devising');
        await actor.unsetRollOption('all','devise-stratagem');
    }

    async handle_roll(id) {

        let message = game.messages.get(id);
        if( !message || !message._roll || !message._roll.dice || !message.isContentVisible ) {
            return;
        }

        if( this.stratagems.hasOwnProperty(id) ) {
            console.log('bingo');
            let data = this.stratagems[id]
            await this.enable_stratagem(message, data.actor, data.token, data.result);
            delete this.stratagems[id];
        }

        if( this.known_crits.hasOwnProperty(id) ) {
            await this.enable_known_weakness(this.known_crits[id].actor, this.known_crits[id].token);
            this.current_knower = this.known_crits[id].actor;
            delete this.known_crits[id];
        }
        let dice = message._roll.dice;

        // we only want to trigger the crit / fumble on d20 rolls, so something with exactly one d20
        let d20_results = dice.filter(die => die.faces == 20 && die.values.length == 1);
        if( d20_results.length != 1 ) {
            return;
        }

        let result = d20_results[0].values[0];
        if( result >= 20 ) {
            //Natty 20!
            this.play('sfx/critical_threat.mp3');
        }
        else if( result == 1 ) {
            this.play('sfx/fan_fumble1.mp3');
        }
    }

    // Roll a recall knowledge check for a player. Player's can request this, or we can roll it ourselves
    recall_knowledge(token, target=null, known_weakness=false) {
        // FYI: canvas.tokens.controlled is the selected tokens
        // we send a message on the socket to the GM

        if( !game.user.isGM ) {
            let user_target = game.user.targets.values().next().value;

            game.socket.emit('module.pf2helper', {
                data : {
                    type:'recall',
                    token_id:token ? token.id : null,
                    target_id:user_target ? user_target.id : null,
                    known_weakness : known_weakness,
                }
            });
            return;
        }
        else if( !target ) {
            target = game.user.targets.values().next().value;
        }
        let actor = token.actor;
        if( !actor ) {
            return;
        }
        console.log(`Recall knowledge for ${actor.name}`);
        if( target ) {
            console.log(`Targetting ${target.actor.name}`);

            let creature_type = null;
            let creature_level = null;

            // Get the type and level from the target
            try {
                creature_type = target.actor.data.data.details.creatureType.toLowerCase();
                // TODO:if this isn't defined, check traits
            }
            catch {}

            if( !creature_type ) {
                try {
                    for(var trait of target.actor.data.data.traits.traits.value) {
                        if(Object.keys(skill_lookup).includes(trait)) {
                            creature_type = trait;
                            break;
                        }
                    }
                }
                catch {
                    console.log(`Failed to find matching trait for ${token.name}`);
                }
            }

            try {
                creature_level = target.actor.data.data.details.level.value;
            }
            catch {}

            //TODO: undefined?
            if( creature_type && creature_level != null && creature_level != undefined ) {
                return this.recall_knowledge_data(token, actor, creature_type, creature_level, known_weakness);
            }
        }
        // Either there was no target or it didn't have the info we wanted, so ask the GM for that info
        let chosen = false;
        let actioned = false;
        let dialog = new Dialog({
            title: 'Recall Knowledge',
            content: `
    <div>Recall Knowledge Creature Type<div>
    <hr/>
    <form>
      <div class="form-group">
        <label>Creature Type:</label>
        <select id="creature-type" name="creature-type">
          <option value="aberration">Abberation</option>
          <option value="animal">Animal</option>
          <option value="astral">Astral</option>
          <option value="beast">Beast</option>
          <option value="celestial">Celestial</option>
          <option value="construct">Construct</option>
          <option value="dragon">Dragon</option>
          <option value="elemental">Elemental</option>
          <option value="ethereal">Ethereal</option>
          <option value="fey">Fey</option>
          <option value="fiend">Fiend</option>
          <option value="fungus">Fungus</option>
          <option value="humanoid">Humanoid</option>
          <option value="monitor">Monitor</option>
          <option value="ooze">Ooze</option>
          <option value="plant">Plant</option>
          <option value="spirit">Spirit</option>
          <option value="undead">Undead</option>
        </select>
      </div>
      <div class="form-group">
        <label>Creature Level</label>
        <input id="creature-level" name="creature-level" type="number"/>
      </div>
    </form>
    `,
            buttons: {
                yes: {
                    icon: "<i class='fas fa-check'></i>",
                    label: "Select Skill",
                    callback: (html) => {chosen = true;},
                },
                no: {
                    icon: "<i class='fas fa-times'></i>",
                    label: `Cancel`,
                },
            },
            default: "Recall",
            close: html => {
                // Let's get the creature type and move onto the next stage
                if( chosen && !actioned ) {
                    actioned = true;
                    let creature_type = html.find('[name="creature-type"]')[0].value;
                    let creature_level = html.find('[name="creature-level"]')[0].value;
                    console.log(`creature_type=${creature_type}`);
                    console.log(`creature_level=${creature_level}`);
                    this.recall_knowledge_data(token, actor, creature_type, creature_level, known_weakness);
                }
            }
        }).render(true);
    }

    recall_knowledge_data(token, actor, creature_type, creature_level, known_weakness) {
        // We want another dialog, this time with the skills that can be rolled, as well as the DC adjustment

        let skills = skill_lookup[creature_type];

        if( !skills ) {
            console.log(`Error: unexpected creature type ${creature_type}`);
            return;
        }

        // We now want to get all of the skills from the creature that are Lores or are in this list
        let skill_options = [];

        for( let skill_abr of Object.keys(actor.data.data.skills) ) {
            let skill = actor.data.data.skills[skill_abr];
            if( skills.includes(skill.name) || (skill.expanded && skill.expanded.type == 'lore') ) {
                skill_options.push( {
                    name : skill.name,
                    abr : skill_abr,
                    rank : skill.rank,
                    modifier : skill.totalModifier
                } );
            }
        }
        if( skill_options.length == 0 ) {
            ui.notifications.warn(`${actor.name} has no appropriate skills`);
            return;
        }
        // That gives us the options, but we need to format the dialog
        if( creature_level < 0 ) {
            creature_level = 0;
        }
        let base_dc = level_dcs[creature_level];
        let option_list = skill_options.map(data => `<option value="${data.abr}">${data.name} (+${data.modifier})</option>`).join("\n");
        let chosen = false;
        let actioned = false;
        let dialog = new Dialog({
            title: 'Recall Knowledge',
            content: `
    <div>Recall Knowledge - ${creature_type}<div>
    <hr/>
    <form>
      <div class="form-group">
        <label>Skill:</label>
        <select id="id-skill" name="id-skill">
          ${option_list}
        </select>
      </div>
      <div class="form-group">
        <label>Difficulty Adjustment</label>
        <select id="dc-adjust" name="dc-adjust">
          <option value="none">None (0)</option>
          <option value="incredibly-easy">Incredibly Easy ((-10)</option>
          <option value="very-easy">Very Easy (-5)</option>
          <option value="easy">Easy (-2)</option>
          <option value="hard">Hard (uncommon) (+2)</option>
          <option value="very-hard">Very Hard (rare) (+5)</option>
          <option value="incredibly-hard">Incredibly Hard (+10)</option>
        </select>
    </form>
    `,
            buttons: {
                yes: {
                    icon: "<i class='fas fa-check'></i>",
                    label: "Select Skill",
                    callback: (html) => {chosen = true;},
                },
                no: {
                    icon: "<i class='fas fa-times'></i>",
                    label: `Cancel`,
                },
            },
            default: "Recall",
            close: html => {
                if( chosen && !actioned ) {
                    actioned = true;
                    // Let's get the creature type and move onto the next stage
                    let skill = html.find('[name="id-skill"]')[0].value;
                    let adjust = html.find('[name="dc-adjust"]')[0].value;
                    let dc = base_dc + dc_adjust[adjust];
                    console.log(`skill=${skill}`);
                    console.log(`adjust=${adjust}`);
                    console.log(`dc=${dc}`);
                    console.log(`known_weakness=${known_weakness}`);
                    skill = actor.data.data.skills[skill];

                    let check = new Roll(`1d20+${skill.totalModifier}`).roll();
                    ChatMessage.create({
                        speaker: {actor:actor},
                        flavor: `<b>${actor.name} rolls a secret DC ${dc} ${skill.name} check</b>`,
                        roll: check,
                        blind: true,
                        whisper: [game.user._id],
                        type: CHAT_MESSAGE_TYPES.ROLL
                    }).then(message => {
                        if( known_weakness && (check.results[0] == 20 || check.total >= (dc + 10) ) ) {
                            console.log('Got known weakness crit!');
                            this.known_crits[message.id] = {actor:actor, token:token};
                        }
                    });
                }
            }
        }).render(true);
    }

    play(name) {
        console.log(`Attempting to play ${name}`)
        if(this.playing) {
            console.log('Sound already playing, abort');
            return;
        }
        let volume = game.settings.get("core","globalInterfaceVolume");
        if( !volume ) {
            volume = 1.0;
        }
        console.log(`Using volume ${volume}`);
        this.playing = true;
        let sound = AudioHelper.play({src:name, volume:volume});
        sound.on('end', () => {
            console.log('Sound completed');
            this.playing = false;
        });
    }

}
