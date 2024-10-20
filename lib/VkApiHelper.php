<?php

declare(strict_types=1);

class VkApiHelper
{
    private CacheInterface $cache;
    private $accessToken;
    private $version;

    public static function getImageURLWithLargestWidth($items)
    {
        usort($items, function ($a, $b) {
            return $b['width'] - $a['width'];
        });
        return $items[0]['url'];
    }

    public static function prepareOwnerNames($r)
    {
        $ownerNames = [];
        foreach ($r['response']['profiles'] ?? [] as $profile) {
            $ownerNames[$profile['id']] = $profile['first_name'] . ' ' . $profile['last_name'];
        }
        foreach ($r['response']['groups'] ?? [] as $group) {
            $ownerNames[-$group['id']] = $group['name'];
        }
        return $ownerNames;
    }

    public static function linkify($ret) {
        // find URLs
        $ret = preg_replace(
            '/((https?|ftp|gopher)\:\/\/[a-zA-Z0-9\-\.]+(:[a-zA-Z0-9]*)?\/?([@\w\-\+\.\?\,\'\/&amp;%\$#\=~\x5C])*)/',
            "<a href='$1'>$1</a>",
            $ret
        );

        // find [id1|Pawel Durow] form links
        $ret = preg_replace('/\[(\w+)\|([^\]]+)\]/', "<a href='https://vk.com/$1'>$2</a>", $ret);

        return $ret;
    }

    public function __construct(CacheInterface $cache, $version, $accessToken = null)
    {
        $this->anonym_token_client_id = '6287487';
        $this->anonym_token_client_secret = 'QbYic1K3lEV5kTGiqlq2';
        $this->anonym_token_scopes = 'audio_anonymous,video_anonymous,photos_anonymous,profile_anonymous';
        $this->anonym_token_version = '1';
        $this->anonym_token_app_id = '6287487';

        $this->cache = $cache;
        $this->version = $version;
        if (!$accessToken) {
            $accessToken = $this->cache->get('guest_api_token');
            if (!$accessToken) {
                $accessToken = $this->getAnonymousAccessToken();
            }
        }
        $this->accessToken = $accessToken;
    }

    private function getAnonymousAccessToken()
    {
        // TODO: make real method
        $access_token = 'anonym.eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbm9ueW1faWQiOjE5OTc3Mjk1MTUsImFwcF9pZCI6NjI4NzQ4NywiaWF0IjoxNzI5NDI5ODM2LCJpc192ZXJpZmllZCI6ZmFsc2UsImV4cCI6MTcyOTUxNjIzNiwic2lnbmVkX3RpbWUiOm51bGwsImFub255bV9pZF9sb25nIjo5MTEyNzk4MzQ5NTcyOTE2MDg0LCJzY29wZSI6Nzg4MTI5OTM0Nzg5ODM2OH0.T1ib0m6I1QDrjlCatXmQVN9hwEDVKPDVx__isHbBmCw';
        return $access_token;
    }

    public function api($method, array $params)
    {
        return json_decode(
            getContents(
                'https://api.vk.com/method/' . $method . '?' . http_build_query(
                    array_merge($params, ['v' => $this->version])
                ),
                ['Authorization: Bearer ' . $this->accessToken]
            ),
            true
        );
    }
}
