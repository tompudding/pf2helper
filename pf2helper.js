Hooks.once('init', () => {
    console.log('init hook');
});

Hooks.once('canvasReady', () => {

    console.log('ready hook');
    game.pf2_helper = new PF2Helper();


});

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
        Hooks.on('diceSoNiceRollComplete', this.handle_roll.bind(this));
        game.socket.on('module.pf2helper', (request) => {
            if( request.data.type == 'inspire' ) {

                if( request.data.sound ) {
                    this.bruce_index = request.data.bruce_index;
                    this.play('sfx/bruce/' + request.data.sound);
                }
                if( game.user.isGM ) {
                    let token = canvas.tokens.objects.children.find( t => t.id == request.data.token_id );
                    this.inspire_courage(request.data.actor, token, false);
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

    devise_stratagem(actor, token, result, message_id) {
        // we receive this call as soon as the chat message has been created, but we need to wait until the 3D
        // dice have finished before doing anything, so we just record the id and let the handle_roll function
        // deal with it when it comes in
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
        if( !game.user.isGM ) {
            return;
        }
        //console.log(combat)
        //console.log(update)
        //console.log(options)
        //console.log(user_id)
        //console.log(combat.current.tokenId);

        // Anything that happens at the end of a turn, let's do that on the previous token
        if( combat.previous && combat.previous.round >= 1 && combat.previous.tokenId ) {
            let last_token = canvas.tokens.objects.children.find(token => token.id == combat.previous.tokenId);
            if( last_token ) {
                await this.end_turn(last_token);
            }
        }

        // Next up, get the token correctly for players, and disable inspire courage on Bruce's turn
        if( combat.current && combat.current.round >= 1 && combat.current.tokenId ) {
            let token = canvas.tokens.objects.children.find(token => token.id == combat.current.tokenId)
            if( token ) {
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
            let data = this.stratagems[id]
            await this.enable_stratagem(message, data.actor, data.token, data.result);
            delete this.stratagems[id];
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
