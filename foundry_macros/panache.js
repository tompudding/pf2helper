let option = "panache";
let options = actor.getRollOptions(["all"]);
let on = false;
let icon = "systems/pf2e/icons/features/classes/panache.jpg";
if( !options.includes(option) ) {
    on = true;
}
actor.toggleRollOption('all',option);
if( token.data.effects.includes(icon) != on ) {
    token.toggleEffect(icon);
}
if( on == false && options.includes("finisher") ) {
    actor.toggleRollOption('all',"finisher");
}
