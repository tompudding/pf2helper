function format_trait(name) {
    return `<div style=\"display:flex;flex-wrap:wrap\"> <span style=\"white-space:nowrap;margin:0 2px 2px 0;padding:0 3px;font-size:10px;line-height:16px;border:1px solid #000000;border-radius:3px;color:white;background:var(--secondary)\">${name}</span>`;
}

async function activate_ds() {
    if( !actor ) {
        return;
    }

    let result = actor.getFlag('pf2helper','stratagem');
    if( result || actor.getFlag('pf2helper','devising')) {
        //await game.pf2_helper.disable_stratagem(actor, token);
        ui.notifications.warn("You cannot use Devise a Stratagem more than once per round");
        return;
    }
    await actor.setFlag('pf2helper','devising', true);

    let stratagem = new Roll('1d20').roll();
    result = stratagem.results[0];
    let traits = ['Concentrate','Fortune','Investigator'].map(trait => format_trait(trait));
console.log('jim');
    stratagem.toMessage(
        {speaker : ChatMessage.getSpeaker({actor:actor}),
         flavor: "<b>Action: Devise a Stratagem</b>" + traits.join(" "),
         rollMode: "roll"
        }
    ).then(message => {
        game.pf2_helper.devise_stratagem(actor, token, result, message._id);
    });

    game.pf2_helper.recall_knowledge(token, null, true);
}

activate_ds();

/* rules elements
{"key":"PF2E.RuleElement.FlatModifier","label":"Stratagem","predicate":{"all":["devise-stratagem"],"any":["finesse","agile","ranged"]},"selector":"attack","type":"ability","value":"@abilities.int.mod"}
{"key":"PF2E.RuleElement.ToggleProperty","property":"flags.pf2e.rollOptions.all.devise-stratagem"}
// then for strategic strike
{"category":"precision","dieSize":"d6","key":"PF2E.RuleElement.DamageDice","predicate":{"all":["devise-stratagem"],"any":["finesse","agile","ranged"]},"selector":"damage","value":{"brackets":[{"end":4,"value":{"diceNumber":1}},{"end":10,"start":5,"value":{"diceNumber":2}},{"end":16,"start":11,"value":{"diceNumber":3}},{"start":17,"value":{"diceNumber":4}}]}}
*/
