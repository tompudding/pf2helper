let playlist = game.playlists.find(pl => pl.data.name == 'GCP');

if( playlist ) {
    let volume = game.settings.get("core","globalInterfaceVolume");
    if( !volume ) {
        volume = 1.0;
    }
    let sound = playlist.data.sounds.find(s => s.name == 'nerdage_short');
    AudioHelper.play({src:sound.path, volume:volume}, true);
}
