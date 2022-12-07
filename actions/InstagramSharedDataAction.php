<?php

/**
 * This file is part of RSS-Bridge, a PHP project capable of generating RSS and
 * Atom feeds for websites that don't have one.
 *
 * For the full license information, please view the UNLICENSE file distributed
 * with this source code.
 *
 * @package Core
 * @license http://unlicense.org/ UNLICENSE
 * @link    https://github.com/rss-bridge/rss-bridge
 */

class InstagramSharedDataAction implements ActionInterface
{
    public function execute(array $request)
    {
        $url = $request['url'] or $this->exit('You must specify url!', 422);

        $bridgeFactory = new \BridgeFactory();

        $bridge = $bridgeFactory->create('InstagramBridge');
        $bridge->loadConfiguration();
        $params = $bridge->detectParameters($url);
        if (!$params) {
            $this->exit('Could not detect paramaters');
        }

        $u = $params['u'] ?? '';
        if (!$u) {
            $this->exit('Could not get user from url');
        }


        if (!is_numeric($u)) {
            $userid = $bridge->loadCacheValue("userid_$u");
            if (!$userid) {
                $this->exit("No data for user $u");
            }
        } else {
            $userid = $u;
        }

        $data = $bridge->loadCacheValue("data_u_$userid");
        if (!$data) {
            $this->exit("No data for user $u");
        }

        header('Content-Type: text/plain');
        echo '<script>window._rssbridgeCache = ';
        echo $data ;
        echo ';</script>';
    }

    private function exit($message, $code = 500)
    {
        http_response_code($code);
        header('content-type: text/plain');
        die($message);
    }

}
