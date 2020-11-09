let token_num = token.actor.data.data.token_num;
if( token_num == undefined ) {
    token_num = 1;
}
else {
    let icon = `common/numbers/${token_num}.png`;
    if( token.data.effects.includes(icon) ) {
        token.toggleEffect(icon);
    }
    token_num += 1;
}
let icon = `common/numbers/${token_num}.png`;
if( !token.data.effects.includes(icon) ) {
    token.toggleEffect(icon);
}
token.actor.update({'data.token_num':token_num});
