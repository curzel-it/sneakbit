package it.curzel.bitscape.rendering

import it.curzel.bitscape.R

object Localization {
    fun numberOfPlayers(numberOfPlayers: Int): Int {
        return when (numberOfPlayers) {
            1 -> R.string.number_of_players_1
            2 -> R.string.number_of_players_2
            3 -> R.string.number_of_players_3
            4 -> R.string.number_of_players_4
            else -> R.string.number_of_players_unknown
        }
    }

    fun locationName(worldId: Int): String {
        return when (worldId) {
            1001 -> "Evergrove"
            1002 -> "Verdant Way"
            1003 -> "Aridreach"
            1004 -> "Duskhaven Dungeons - 1st Floor"
            1005 -> "Duskhaven Dungeons - 2nd Floor"
            1006 -> "Thermoria"
            1007 -> "Mount Ignis Underground"
            1008 -> "Maritide Haven"
            1009 -> "Maritide Haven Mines"
            1010 -> "Shadowveil Path"
            1011 -> "Duskhaven"
            1012 -> "Vintoria"
            1013 -> "Grimsun Basin"
            1014 -> "Vintoria Power Plant - 1st Floor"
            1015 -> "Vintoria Power Plant - 2nd Floor"
            1016 -> "Vintoria Power Plant - 3rd Floor"
            1017 -> "Demon Lord Maze"
            1018 -> "Murkmire Swamps"
            1019 -> "Vintoria Maze"
            1020 -> "Peak Levek"
            1021 -> "Peak Levek Underground"
            1022 -> "Duskhaven Maze"
            else -> "???"
        }
    }
}