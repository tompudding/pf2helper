let token_num = token.actor.data.data.token_num;
if( token_num != undefined ) {
    let icon = `common/numbers/${token_num}.png`;
    if( token.data.effects.includes(icon) ) {
        token.toggleEffect(icon);
    }
    token.actor.update({'data.token_num':0});
}
