var Mutex = function() {
  this._busy  = false;
  this._queue = [];
};

Mutex.prototype.synchronize = function(task) {
  var self = this;

  return new Promise(function(resolve, reject) {
    self._queue.push([task, resolve, reject]);
    if (!self._busy) self._dequeue();
  });
};

Mutex.prototype._execute = function(record) {
  var task    = record[0],
      resolve = record[1],
      reject  = record[2],
      self    = this;

  task().then(resolve, reject).then(function() {
    self._dequeue();
  });
};

Mutex.prototype._dequeue = function() {
  this._busy = true;
  var next = this._queue.shift();

  if (next)
    this._execute(next);
  else
    this._busy = false;
};


Hooks.once('init', () => {
    console.log('init hook');
});

Hooks.once('canvasReady', () => {

    console.log('ready hook');
    game.pf2_helper = new PF2Helper();
});

var mutex = new Mutex();

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
    'incredibly_easy' : -10,
    'very_easy' : -5,
    'easy' : -2,
    'hard' : +2,
    'very_hard' : +5,
    'incredibly_hard' : +10,
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

    // For inspire courage it's a bit more complicated now, we want to remove all 3 possible icons
    let courage = has_courage(token);
    let defence = has_defence(token);
    for(let i = 1; i < 4; i++) {
        let icon = `modules/pf2helper/inspire_${i}.png`;
        let required = courage == i;
        if( required != token.data.effects.includes(icon) ) {
            await token.toggleEffect(icon);
        }
        icon = `modules/pf2helper/defence_${i}.png`;
        required = defence == i;
        if( required != token.data.effects.includes(icon) ) {
            await token.toggleEffect(icon);
        }
    }
    // the plus icons for inspire courage...
    let courage_bonus = 0;
    let defence_bonus = 0;
    if( token.actor.data.data.customModifiers ) {
        if( token.actor.data.data.customModifiers['attack'] ) {
            let mod = token.actor.data.data.customModifiers['attack'].find(modifier => modifier.name == 'Inspire Courage');
            if( mod ) {
                courage_bonus = mod.modifier;
            }
        }
        if( token.actor.data.data.customModifiers['ac'] ) {
            let mod = token.actor.data.data.customModifiers['ac'].find(modifier => modifier.name == 'Inspire Defence');
            if( mod ) {
                defence_bonus = mod.modifier;
            }
        }
    }
    for(let i = 1; i < 4; i++) {
        let icon = `modules/pf2helper/inspire_plus_${i}.png`;
        let required = courage_bonus == i;
        if( required != token.data.effects.includes(icon) ) {
            await token.toggleEffect(icon);
        }
        icon = `modules/pf2helper/defence_plus_${i}.png`;
        required = defence_bonus == i;
        if( required != token.data.effects.includes(icon) ) {
            await token.toggleEffect(icon);
        }
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

function has_inspire(token, type)
{
    if( !token || !token.actor ) {
        return 0;
    }
    let result = token.actor.getFlag('pf2helper',type);
    if( result ) {
        return result;
    }
    return 0;
}

function has_courage(token) {
    return has_inspire(token, 'inspire_courage');
}

function has_defence(token) {
    return has_inspire(token, 'inspire_defence');
}

function has_know_weakness(token) {
    if( !token || !token.actor || !token.actor.data.data.customModifiers ) {
        return false;
    }
    return ((token.actor.data.data.customModifiers['attack'] || []).
            some(modifier => modifier.name === 'Know Weakness'));
}

function get_recall_knowledge_modifier(actor, skill_abr) {
    let modifier = actor.data.data.skills[skill_abr].totalModifier;
    let skill = actor.data.data.skills[skill_abr];
    if( skill.rank == 0 && actor.data.items.find( item => item.name == 'Keen Recollection') ) {
        // Investigator's with Keen Recollection add their level to untrained recall knowledge checks
        modifier += actor.data.data.details.level.value;
    }

    return modifier;
}

async function set_inspire(token, duration, amount, flag_name, token_stub, off, on) {
    let messageContent = '';
    let actor = token.actor;
    let current_duration = has_inspire(token, flag_name);
    let current_amount = has_inspire(token, flag_name + '_amount');
    let plus_stub = token_stub + 'plus_';
    if( duration > 4 ) {
        duration = 4;
    }
    if( duration == current_duration && amount == current_amount) {
        return;
    }

    if( !actor ) {
        return;
    }

    if( duration == 0 ) {
        amount = 0;
    }

    if( duration != current_duration ) {
        await token.actor.setFlag('pf2helper',flag_name, duration);
        if( current_duration ) {
            //We're changing the value, so we need to turn off any current icon
            let current_icon = `${token_stub}${current_duration}.png`;
            if (token.data.effects.includes(current_icon)) {
                await token.toggleEffect(current_icon)
            }
        }
    }

    if( amount != current_amount ) {
        await token.actor.setFlag('pf2helper',flag_name + '_amount', amount);
        // Also remove all the possible plus values
        for(var on_icon of token.data.effects.filter(icon => icon.indexOf(plus_stub) == 0)) {
            await token.toggleEffect(on_icon);
        }
    }

    await off(actor);

    if( duration == 0 ) {
        // We're just turning it off, so we need to remove the bonus and we're done!
        return;
    }

    await on(actor);
    if( duration != current_duration ) {
        let current_icon = `${token_stub}${duration}.png`;
        if (!token.data.effects.includes(current_icon)) {
            await token.toggleEffect(current_icon)
        }
    }
    if( amount != current_amount ) {
        let current_plus = `${plus_stub}${amount}.png`;
        await token.toggleEffect(current_plus);
    }
}

var effects = {
    'inspire_courage' : { 1 : { 1 : 'beReeFroAx24hj83', // duration 1, amount 1 = inspire courage
                                2 : '', // duration 1, amount 2 = inspire heroic courage success
                                3 : '', // duration 1, amount 3 = inspire heroic courage crit success
                              },
                          3 : { 1 : '', // duration 3, amount 1 = lingering courage success}
                              },
                          4 : { 1 : '', // duration 4, amount 1 = lingering courage crit success
                              },
                        },
    'inspire_defence' : { 1 : { 1 : 'beReeFroAx24hj83', // duration 1, amount 1 = inspire courage
                                2 : '', // duration 1, amount 2 = inspire heroic courage success
                                3 : '', // duration 1, amount 3 = inspire heroic courage crit success
                              },
                          3 : { 1 : '', // duration 3, amount 1 = lingering courage success}
                              },
                          4 : { 1 : '', // duration 4, amount 1 = lingering courage crit success
                              },
                        }
};

async function set_inspire_new(token, duration, amount, flag_name, token_stub, off, on) {

    console.log(`set flag_name=${flag_name} token_stub=${token_stub} to amount=${amount} duration=${duration}`)
    let uuid = effects[flag_name][duration][amount];
    let actor = token.actor;
    if( !uuid || !actor ) {
        return;
    }
    uuid = 'Compendium.pf2e.spell-effects.' + uuid;

    const source = (await fromUuid(uuid)).toObject();
    source.flags.core ??= {};
    source.flags.core.sourceId = uuid;

    const existing = token.actor.itemTypes.effect.find((effect) => effect.getFlag('core', 'sourceId') === uuid);
    if (!existing) {
        await token.actor.createEmbeddedDocuments('Item', [source]);
    }
}

async function set_inspire_courage(token, duration, amount) {
    console.log(`set inspire courage duration=${duration} amount=${amount}`);
    await set_inspire(token, duration, amount, 'inspire_courage', 'modules/pf2helper/inspire_',
                      async (actor) => {
                          try {
                              await actor.removeCustomModifier('attack', 'Inspire Courage');
                              await actor.removeCustomModifier('damage', 'Inspire Courage');
                          }
                          catch (err) {
                              console.log('Failed to remove custom modifier');
                          }
                      },
                      async (actor) => {
                          await actor.addCustomModifier('attack', 'Inspire Courage', amount, 'status');
                          await actor.addCustomModifier('damage', 'Inspire Courage', amount, 'status');
                      });

}

async function set_inspire_defence(token, duration, amount) {
    let name = 'Inspire Defence';
    await set_inspire(
        token, duration, amount, 'inspire_defence', 'modules/pf2helper/defence_',
        async (actor) => {
            await actor.removeCustomModifier('ac', name);
            await actor.removeCustomModifier('saving-throw', 'Inspire Defence');
            let resistances = actor.data.data.traits.dr.filter(e => e.source != name);
            await actor.update({'data.traits.dr':resistances});
        },
        async (actor) => {
            let char_level = actor.data.data.details.level.value;
            let spell_level = (char_level + 1) >> 1;
            await actor.addCustomModifier('ac', 'Inspire Defence', amount, 'status');
            await actor.addCustomModifier('saving-throw', 'Inspire Defence', amount, 'status');
            let resistances = actor.data.data.traits.dr.filter(e => e.source != name);
            resistances.push({type:'physical',
                              value:spell_level >> 1,
                              exceptions:'',
                              source:name});
            await actor.update({'data.traits.dr':resistances});
        });

}

async function disable_all_inspire_courage(token) {
    let promise_array = [];
    for (let target_token of canvas.tokens.objects.children) {
        if( target_token.data.disposition == token.data.disposition ) {
            promise_array.push(set_inspire_courage(target_token, 0, 0));
        }
    }
    await Promise.all(promise_array);
}

async function disable_all_inspire_defence(token) {
    let promise_array = [];
    for (let target_token of canvas.tokens.objects.children) {
        if( target_token.data.disposition == token.data.disposition ) {
            promise_array.push(set_inspire_defence(target_token, 0, 0));
        }
    }
    await Promise.all(promise_array);
}

async function change_all_inspire(token, diff) {
    await mutex.synchronize( async function() {
        let promise_array = [];
        for (let target_token of canvas.tokens.objects.children) {
            if( target_token.data.disposition == token.data.disposition ) {
                let current_courage_duration = has_courage(target_token);
                let current_courage_amount = has_inspire(target_token, 'inspire_courage_amount');
                console.log(`current_courage_duration = ${current_courage_duration} current_courage_amount=${current_courage_amount}`)
                if( current_courage_duration ) {
                    promise_array.push(set_inspire_courage(target_token, current_courage_duration + diff, current_courage_amount));
                }
                let current_defence_duration = has_defence(target_token);
                let current_defence_amount = has_inspire(target_token, 'inspire_defence_amount');
                if( current_defence_duration ) {
                    promise_array.push(set_inspire_defence(target_token, current_defence_duration + diff, current_defence_amount));
                }
            }
        }
        await Promise.all(promise_array);
    });
}

function choose(choices) {
  var index = Math.floor(Math.random() * choices.length);
  return choices[index];
}

function song_parts(stub, num) {
    let parts = [];

    for(var i = 1; i < num+1; i++) {
        parts.push( `${stub}${i}.ogg` );
    }
    return parts;
}

class PF2Helper {

    constructor() {
        this.playing = false;
        this.bruce_sounds = [...song_parts('born',5), ...song_parts('fire', 8), ...song_parts('young',2)];
        this.bruce_index = Math.floor(Math.random() * this.bruce_sounds.length);
        this.stratagems = {};
        this.lingering = {};
        this.heroics = {}
        this.known_crits = {};
        this.current_knower = null;
        // In 0.7.7 it looks like the combat has stopped showing previous correctly. In order to be able to
        // catch things like adding people to initiative and ending turns correctly, I'll keep track of the
        // current combat info myself
        // this.combat = {round : -1,
        //                turn : -1,
        //                num_tokens : 0,
        //                last_token : null,
        //               };
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
                    if( request.data.name == 'Inspire Courage' ) {
                        this.inspire(request.data.actor,
                                     token,
                                     request.data.name,
                                     has_courage,
                                     set_inspire_courage,
                                     disable_all_inspire_courage,
                                     false);
                    }
                    else {
                        this.inspire(request.data.actor,
                                     token,
                                     request.data.name,
                                     has_defence,
                                     set_inspire_defence,
                                     disable_all_inspire_defence,
                                     false);
                    }
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
            else if( request.data.type == 'linger' ) {
                console.log('got linger');
                if( game.user.isGM ) {
                    this.lingering_composition(request.data.actor, token, request.data.perf_type);
                }
            }
            else if( request.data.type == 'heroics' ) {
                console.log('got heroics');
                if( game.user.isGM ) {
                    this.inspire_heroics(request.data.actor, token, request.data.perf_type);
                }
            }
        });
        Hooks.on('createCombat', this.create_combat.bind(this));
        if( !game.user.isGM ) {
            return;
        }
        //Hooks.on('updateCombat', this.handle_combat.bind(this));
        Hooks.on('pf2e.startTurn', this.start_turn.bind(this));
        Hooks.on('pf2e.endTurn',this.end_turn.bind(this));
        Hooks.on("canvasReady", this.handle_scene.bind(this));
        Hooks.on('createChatMessage', this.handle_chat.bind(this));

        this.handle_scene();
    }

    //helper functions for macros
    async change_all_inspire(diff) {
        let bruce = canvas.tokens.objects.children.find(token => token.name.startsWith('Bruce'));
        if( bruce ) {
            await change_all_inspire(bruce, diff);
        }
    }

    async change_inspire(diff) {
        for(var token of canvas.tokens.controlled) {
            let current_courage = has_courage(token);
            if( current_courage ) {
                await set_inspire_courage(token, current_courage + diff, 0);
            }
        }
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

    get_inspired_tokens(source) {
        console.log(source);
        let inspired = [];

        let grid_size = canvas.grid.size;
        let grid_pos = {x:source.x / grid_size,
                        y:source.y / grid_size};

        for (let target_token of canvas.tokens.objects.children) {
            let target_pos = {x : target_token.x / grid_size,
                              y : target_token.y / grid_size};
            let distance = pathfinder_distance(grid_pos, target_pos);
            if( distance <= 12 && target_token.data.disposition >= 1 ) {
                inspired.push(target_token);
            }
        }
        return inspired;
    }

    async inspire(actor, token, name, check, set, disable, from_click=true, duration=1, amount=1) {
        console.log('***Inspire Courage!***');

        if( from_click ) {
            let sound = null;
            if( !actor.data.items.find( item => item.name == name) ) {
                this.play('sfx/family_fortunes.mp3');
                return;
            }
            if( !check(token) ) {
                sound = this.get_bruce_sound();
                this.play('sfx/bruce/' + sound);
            }

            game.socket.emit('module.pf2helper', {
                data : {
                    type:'inspire',
                    name:name,
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

        let promise_array = [];
        // If it's already on, turn it off for everyone
        if( check(token) ) {
            promise_array.push(disable(token));
        }
        else {
            for(let target of this.get_inspired_tokens(token) ) {
                promise_array.push(set(target, duration, amount));
            }
        }
        await Promise.all(promise_array);
    }

    async inspire_courage(actor, token, from_click=true, duration=1) {
        let obj = this;
        await mutex.synchronize( async function() {
            console.log('***Inspire Courage!***');
            await obj.inspire(actor, token, 'Inspire Courage', has_courage, set_inspire_courage, disable_all_inspire_courage, from_click, duration);
        });
    }

    async inspire_defence(actor, token, from_click=true, duration=1) {
        let obj = this;
        await mutex.synchronize( async function() {
            console.log('***Inspire Defence!***');
            await obj.inspire(actor, token, 'Inspire Defense', has_defence, set_inspire_defence, disable_all_inspire_defence, from_click, duration);
        });
    }

    async lingering_composition(actor, token, perf_type) {
        let obj = this;
        await mutex.synchronize( async function() {
            // This function is called when the player clicks their macro, and it needs to roll a performance
            // check, then set up for inspire courage to be added when complete. We'll have the GM do it because
            // users can't put icons on other people's tokens
            if( !token || !token.actor ) {
                return;
            }
            if( !token.actor.data.items.find( item => item.name == 'Lingering Composition') ) {
                obj.play('sfx/family_fortunes.mp3');
                return;
            }
            if( !game.user.isGM ) {
                game.socket.emit('module.pf2helper', {
                    data : {
                        type:'linger',
                        perf_type:perf_type,
                        token_id:token ? token.id : null,
                        actor_id:actor ? actor.id : null,
                    }
                });
                return;
            }
            let sound = obj.get_bruce_sound();
            obj.play('sfx/bruce/' + sound, true);

            let target_level = 1;
            let target_tokens = obj.get_inspired_tokens(token);
            for( let target of target_tokens ) {
                if( target.actor && target.actor.data.data.details.level.value > target_level ) {
                    target_level = target.actor.data.data.details.level.value;
                }
            }
            let dc = level_dcs[target_level] + dc_adjust.hard;
            await ChatMessage.create({
                speaker: {actor:actor},
                content: `<b>Lingering Performance with DC ${dc}</b>`,
                flavor:`Highest Level:${target_level} DC: ${level_dcs[target_level]} Hard:${dc_adjust.hard}`,
            })

            //When we're the GM we need that nice roll
            const options = token.actor.getRollOptions(['all', 'cha-based', 'skill-check', 'performance']);
            token.actor.data.data.skills.prf.roll({options:options, callback:roll => {
                obj.lingering[roll.message.id] = {actor : actor, token : token, perf_type : perf_type, dc: dc};
            }});
        });
    }

    async inspire_heroics(actor, token, perf_type) {
        let obj = this;
        await mutex.synchronize( async function() {
            // This function is called when the player clicks their macro, and it needs to roll a performance
            // check, then set up for inspire courage to be added when complete. We'll have the GM do it because
            // users can't put icons on other people's tokens
            if( !token || !token.actor ) {
                return;
            }
            if( !token.actor.data.items.find( item => item.name == 'Inspire Heroics') ) {
                obj.play('sfx/family_fortunes.mp3');
                return;
            }
            if( !game.user.isGM ) {
                game.socket.emit('module.pf2helper', {
                    data : {
                        type:'heroics',
                        perf_type:perf_type,
                        token_id:token ? token.id : null,
                        actor_id:actor ? actor.id : null,
                    }
                });
                return;
            }
            let sound = obj.get_bruce_sound();
            obj.play('sfx/bruce/' + sound, true);

            let target_level = 1;
            let target_tokens = obj.get_inspired_tokens(token);
            for( let target of target_tokens ) {
                if( target.actor && target.actor.data.data.details.level.value > target_level ) {
                    target_level = target.actor.data.data.details.level.value;
                }
            }
            let dc = level_dcs[target_level] + dc_adjust.very_hard;
            await ChatMessage.create({
                speaker: {actor:actor},
                content: `<b>Inspire Heroics with DC ${dc}</b>`,
                flavor:`Highest Level:${target_level} DC: ${level_dcs[target_level]} Very Hard:${dc_adjust.very_hard}`,
            })

            //When we're the GM we need that nice roll
            const options = token.actor.getRollOptions(['all', 'cha-based', 'skill-check', 'performance']);
            token.actor.data.data.skills.prf.roll({options:options, callback:roll => {
                obj.heroics[roll.message.id] = {actor : actor, token : token, perf_type : perf_type, dc: dc};
            }});
        });
    }

    async enable_known_weakness(actor, token) {
        for (let target_token of canvas.tokens.objects.children) {
             if( target_token.data.disposition >= 1 ) {
                 if( !target_token.actor || has_know_weakness(target_token) ) {
                     continue;
                 }

                 await target_token.actor.addCustomModifier('attack', 'Know Weakness', 1, 'circumstance');
                 let icon = "systems/pf2e/icons/conditions-2/status_powerup.webp";
                 if (!target_token.data.effects.includes(icon)) {
                     await target_token.toggleEffect(icon)
                 }
            }
        }
    }

    async disable_known_weakness(token) {
        await mutex.synchronize( async function() {
            let messageContent = '';
            let actor = token.actor;
            if(!has_know_weakness(token)) {
                return;
            }
            await actor.removeCustomModifier('attack', 'Know Weakness');

            let icon = "systems/pf2e/icons/conditions-2/status_powerup.webp";

            if (token.data.effects.includes(icon)) {
                await token.toggleEffect(icon)
            }
        });
    }


    devise_stratagem(actor, token, result, message_id) {
        // we receive this call as soon as the chat message has been created, but we need to wait until the 3D
        // dice have finished before doing anything, so we just record the id and let the handle_roll function
        // deal with it when it comes in
        if( !actor.data.items.find( item => item.name == 'Devise a Stratagem') ) {
            this.play('sfx/family_fortunes.mp3');
            return;
        }
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

    async start_turn(combatant, combat, user_id) {
        let token = canvas.tokens.get(combatant.token.id);
        let actor = token.actor;
        if( !token || !actor ) {
            return;
        }
        //console.log(combatant);
        if( actor.data.data.reaction_used ) {
            actor.update({'data.reaction_used':false});
            actor.data.data.reaction_used = false;
            update_token(token);
        }
        if( actor.name.startsWith('Bruce ') ) {
            await change_all_inspire(token, -1);
        }
        if( this.current_knower == null || (this.current_knower && token.actor == this.current_knower) ) {
            this.current_knower = null;
            for (let target_token of canvas.tokens.objects.children) {
                this.disable_known_weakness(target_token);
            }
        }
    }

    async end_turn(combatant, combat, user_id) {
        let token = canvas.tokens.get(combatant.token.id);
        let actor = token.actor;

        if( !actor ) {
            return;
        }

        await this.disable_stratagem(actor, token);

        if( !actor.data || !actor.data.items ) {
            return;
        }

        let items = actor.data.items.contents;

        // decrease any frightened on the token by 1
        for(let i = 0; i < items.length; i++) {
            if( items[i].type != 'condition' ) {
                continue;
            }

            if( items[i].name == 'Frightened' ) {
                console.log(items[i]);
                //token.statusEffectChanged = true;
                await game.pf2e.ConditionManager.updateConditionValue(items[i].id, token, items[i].value - 1);
                //await game.pf2e.StatusEffects.setStatus(token, [{ name:'frightened', value: (items[i].value - 1).toString()}]);
            }

            if( items[i].name == 'Persistent Damage' ) {
                await ChatMessage.create({
                    speaker: {actor:actor},
                    content: `<b>${actor.name} has persistent damage!</b>`,
                })
            }
        }
        for(let token of canvas.tokens.objects.children) {
            if( !token || !token.actor ) {
                continue;
            }
            game.pf2e.effectTracker.removeExpired(token.actor);
        }
    }

    // async handle_combat(combat, update, options, user_id) {
    //     if( !game.user.isGM || !combat || !combat.current || combat.turn < 0 ) {
    //         return;
    //     }

    //     if( this.combat.num_tokens != combat.turns.length ) {
    //         //this is presumably an update with new players or some dead or something
    //         this.combat.round = combat.current.round;
    //         this.combat.turn = combat.current.turn;
    //         this.combat.num_tokens = combat.turns.length;
    //         return;
    //     }
    //     if( this.combat.turn == combat.current.turn ) {
    //         // Why did this happen?
    //         return;
    //     }
    //     // for(let token of canvas.tokens.objects.children) {
    //     //     if( !token || !token.actor ) {
    //     //         continue;
    //     //     }
    //     //     game.pf2e.effectTracker.removeExpired(token.actor);
    //     // }
    //     // if( this.combat.last_token ) {
    //     //     let last_token = canvas.tokens.objects.children.find(token => token.id == this.combat.last_token);
    //     //     if( last_token ) {
    //     //         console.log(`End turn on ${last_token.name}`);
    //     //         await this.end_turn(last_token);
    //     //     }
    //     // }
    //     this.combat.round = combat.current.round;
    //     this.combat.turn = combat.current.turn;
    //     this.combat.last_token = combat.current.tokenId;

    //     // Next up, get the token correctly for players, and disable inspire courage on Bruce's turn
    //     if( combat.current && combat.current.round >= 1 && combat.current.tokenId ) {
    //         let token = canvas.tokens.objects.children.find(token => token.id == combat.current.tokenId)
    //         if( token ) {
    //             console.log(`Start turn on ${token.name}`)
    //             await this.start_turn(token);
    //         }
    //     }
    // }

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
        await actor.unsetRollOption('all','devise-a-stratagem');
    }

    async handle_roll(id) {

        let message = game.messages.get(id);
        if( !message || !message.isContentVisible ) {
            console.log('skip message');
            return;
        }
        let d20_rolls = [];

        if( message._roll && message._roll.dice ) {
            if( this.stratagems.hasOwnProperty(id) ) {
                let data = this.stratagems[id]
                await this.enable_stratagem(message, data.actor, data.token, data.result);
                delete this.stratagems[id];
            }

            if( this.known_crits.hasOwnProperty(id) ) {
                await this.enable_known_weakness(this.known_crits[id].actor, this.known_crits[id].token);
                this.current_knower = this.known_crits[id].actor;
                delete this.known_crits[id];
            }

            if( this.lingering.hasOwnProperty(id) ) {
                // First we need to establish what the DC was, which depends on the subjects. First find the
                // highest level subject
                let data = this.lingering[id];
                delete this.lingering[id];

                let dc = data.dc;


                // How did they do? Crit_fail = 0, fail = 1, success = 2, crit = 3
                let durations = [0, 1, 3, 4];
                let result = 0;

                if( message.roll.total >= dc + 10 ) {
                    result = 3;
                }
                else if( message.roll.total >= dc ) {
                    result = 2;
                }
                else if( message.roll.total > dc - 10 ) {
                    result = 1;
                }

                if( message.roll.terms[0].results[0] == 20 ) {
                    result = Math.min(result + 1, 3);
                }
                else if( message.roll.terms[0].results[0] == 1 ) {
                    result = Math.max(result - 1, 0);
                }
                let duration = durations[result];
                let promise_array = [];
                for( let target of this.get_inspired_tokens(data.token) ) {
                    if( data.perf_type == 'courage' ) {
                        promise_array.push(set_inspire_courage(target, duration, 1));
                    }
                    else {
                        promise_array.push(set_inspire_defence(target, duration, 1));
                    }
                }
                await Promise.all(promise_array);
            }
            if( this.heroics.hasOwnProperty(id) ) {
                // First we need to establish what the DC was, which depends on the subjects. First find the
                // highest level subject
                let data = this.heroics[id];
                delete this.heroics[id];

                let dc = data.dc;

                // How did they do? Crit_fail = 0, fail = 1, success = 2, crit = 3
                let bonuses = [1, 1, 2, 3];
                let result = 0;

                if( message.roll.total >= dc + 10 ) {
                    result = 3;
                }
                else if( message.roll.total >= dc ) {
                    result = 2;
                }
                else if( message.roll.total > dc - 10 ) {
                    result = 1;
                }

                if( message.roll.terms[0].results[0] == 20 ) {
                    result = Math.min(result + 1, 3);
                }
                else if( message.roll.terms[0].results[0] == 1 ) {
                    result = Math.max(result - 1, 0);
                }
                let bonus = bonuses[result];
                let promise_array = [];
                for( let target of this.get_inspired_tokens(data.token) ) {
                    if( data.perf_type == 'courage' ) {
                        promise_array.push(set_inspire_courage(target, 1, bonus));
                    }
                    else {
                        promise_array.push(set_inspire_defence(target, 1, bonus));
                    }
                }
                await Promise.all(promise_array);
            }
            d20_rolls.push(message._roll.dice);
        }
        else {
            // This might still be an inline roll (for double-slice or twin-feint), from which we still want
            // to play the sounds

            if( message.data.content.indexOf('inline-roll') !== -1 ) {
                let JqInlineRolls = $($.parseHTML(message.data.content)).find(".inline-roll");
                if(JqInlineRolls.length == 0 && !message.isRoll) {
                    JqInlineRolls = $($.parseHTML(message.data.content)).filter(".inline-roll");
                    console.log('false positive');

                }

                let inlineRollList = [];
                // Don't go mad, lots of inline rolls is bad, but 2 for double-slice or twin-feint is ok
                if(JqInlineRolls.length <= 2) {
                    JqInlineRolls.each((index,el) => {
                        d20_rolls.push(Roll.fromJSON(unescape(el.dataset.roll)).dice);
                    });
                }


            }
        }

        for(var dice of d20_rolls) {
            // we only want to trigger the crit / fumble on d20 rolls, so something with exactly one d20
            let d20_results = dice.filter(die => die.faces == 20 && die.values.length == 1);
            if( d20_results.length != 1 ) {
                return;
            }

            let result = d20_results[0].values[0];
            if( result >= 20 ) {
                //Natty 20!
                this.play(message.user.isGM ? 'sfx/troy_roll.mp3' : 'sfx/critical_threat.mp3');
            }
            else if( result == 1 ) {
                this.play('sfx/fan_fumble1.mp3');
            }
        }
    }

    set_inspire_value(token, flag_name, set) {
        let chosen = false;
        let actioned = false;
        let current_duration = has_inspire(token, flag_name);
        let current_amount = has_inspire(token, flag_name + '_amount');
        let obj = this;

        let dialog = new Dialog({
            title: 'Set Inspire Courage',
            content: `
    <div>Level<div>
    <hr/>
    <form>
      <div class="form-group">
        <label>Duration</label>
        <input id="duration" name="duration" type="number" value="${current_duration}"/>
<label>Value</label>
      </div>
      <div class="form-group">
      <label>Amount</label>
        <input id="amount" name="amount" type="number" value="${current_amount}"/>
      </div>
    </form>
    `,
                buttons: {
                    yes: {
                        icon: "<i class='fas fa-check'></i>",
                        label: "Update",
                        callback: (html) => {chosen = true;},
                    },
                    no: {
                        icon: "<i class='fas fa-times'></i>",
                        label: `Cancel`,
                    },
                },
                default: "Recall",
            close: async function(html) {
                    if( chosen && !actioned ) {
                        actioned = true;
                        let new_duration = parseInt(html.find('[name="duration"]')[0].value);
                        let new_amount = parseInt(html.find('[name="amount"]')[0].value);
                        console.log(`new_duration=${new_duration}`);
                        console.log(`new_amount=${new_amount}`);
                        //this.recall_knowledge_data(token, actor, creature_type, creature_level, known_weakness);
                        if( new_amount != current_amount || new_duration != current_duration ) {
                            let promise_array = [];
                            for(let target of obj.get_inspired_tokens(token) ) {
                                promise_array.push(set(target, new_duration, new_amount));
                            }
                            await Promise.all(promise_array);
                        }
                    }
            }
        }).render(true);

    }

    set_inspire_courage_value(token) {
        return this.set_inspire_value(token, 'inspire_courage', set_inspire_courage);
    }

    set_inspire_defence_value(token) {
        return this.set_inspire_value(token, 'inspire_defence', set_inspire_defence);
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
                    modifier : get_recall_knowledge_modifier(actor, skill_abr),
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
          <option value="incredibly_easy">Incredibly Easy ((-10)</option>
          <option value="very_easy">Very Easy (-5)</option>
          <option value="easy">Easy (-2)</option>
          <option value="hard">Hard (uncommon) (+2)</option>
          <option value="very_hard">Very Hard (rare) (+5)</option>
          <option value="incredibly_hard">Incredibly Hard (+10)</option>
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
                    let modifier = get_recall_knowledge_modifier(actor, skill);
                    skill = actor.data.data.skills[skill];

                    // let options = actor.getRollOptions(['all', 'int-based', 'skill-check', skill.name]);
                    // options.push('secret');
                    // skill.roll({options:options, callback:check => {
                    //     if( known_weakness && (check.terms[0].results[0] == 20 || check.total >= (dc + 10) ) ) {
                    //         //Got a known weakness crit, but we don't
                    //         this.known_crits[check.message.id] = {actor:actor, token:token};
                    //     }
                    //     //this.lingering[roll.message.id] = {actor : actor, token : token};
                    // }});

                    let check = new Roll(`1d20+${modifier}`).roll();
                    ChatMessage.create({
                        speaker: {actor:actor},
                        flavor: `<b>${actor.name} rolls a secret DC ${dc} ${skill.name} check</b>`,
                        roll: check,
                        blind: true,
                        whisper: [game.user._id],
                        type: CONST.CHAT_MESSAGE_TYPES.ROLL
                    }).then(message => {
                        if( known_weakness && (check.terms[0].results[0] == 20 || check.total >= (dc + 10) ) ) {
                            //Got a known weakness crit, but we don't
                            this.known_crits[message.id] = {actor:actor, token:token};
                        }
                    });
                }
            }
        }).render(true);
    }

    play(name, for_all=false) {
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
        let obj = this;
        AudioHelper.play({src:name, volume:volume}, for_all).then(
            function(sound) {
                sound.on('end', () => {
                    console.log('Sound completed');
                    obj.playing = false;
                });
            }
        );
    }

}
