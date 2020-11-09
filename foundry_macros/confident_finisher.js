let option = "finisher";
let options = actor.getRollOptions(["all"]);

if( options.includes("panache") ) {
    actor.toggleRollOption('all',option);
}
else {
    ui.notifications.warn("You must have panache to use Confident Finisher");
}
