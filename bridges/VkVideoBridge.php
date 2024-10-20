<?php

class VkVideoBridge extends BridgeAbstract
{
    const MAINTAINER = 'em92';
    const NAME = 'VK Видео';
    const URI = 'https://vk.com/video';
    const DESCRIPTION = 'Видеозаписи пользователя/группы';
    const CACHE_TIMEOUT = 300; // 5 minutes
    const PARAMETERS = [
        [
            'u' => [
                'name' => 'Короткое имя группы или профиля (из ссылки)',
                'exampleValue' => '@goblin_oper_ru',
                'required' => true
            ],
        ]
    ];

    protected $pageName;
    private $rateLimitCacheKey = 'vkvideo_rate_limit';

    protected function getInput($input)
    {
        $r = parent::getInput($input);
        if (($input == 'u') && (!str_starts_with($input, '@'))) {
            $r = '@' . $r;
        }
        return $r;

    }

    public function getURI()
    {
        if (!is_null($this->getInput('u'))) {
            return static::URI . '/' . $this->getInput('u');
        }

        return parent::getURI();
    }


    public function collectData()
    {
        $uri = $this->getURI();
        $this->helper = new VkApiHelper($this->cache, '5.238');

        $r = $this->api('catalog.getVideo', [
            'url' => $this->getURI(),
            'owner_id' => '0',
            'need_blocks' => '1',
        ]);

        $this->generateFeed($r);
    }

    protected function generateFeed($r)
    {
        $ownerNames = $this->helper->prepareOwnerNames($r);

        $alreadyIncludedVideoIds = [];
        foreach($r['response']['videos'] as $video) {
            $video_id = strval($video['owner_id']) . '_' . strval($video['id']);

            if (in_array($video_id, $alreadyIncludedVideoIds)) {
                continue;
            }

            $item = [];
            if (isset($video['files']['external'])) {
                $item['uri'] = $video['files']['external'];
            } else {
                $item['uri'] = static::URI . $video_id;
            }

            $image_url = $this->helper->getImageURLWithLargestWidth($video['image']);
            $content = "<img src='$image_url' /><br />";
            $content .= nl2br($video['description']);

            $item['content'] = $content;
            $item['timestamp'] = $video['date'];
            $item['author'] = $ownerNames[$video['owner_id']];
            $item['title'] = $video['title'];

            $this->items[] = $item;
            array_push($alreadyIncludedVideoIds, $video_id);
        }

    }

    protected function api($method, array $params, $expected_error_codes = [])
    {
        $r = $this->helper->api($method, $params);
        if (isset($r['error']) && !in_array($r['error']['error_code'], $expected_error_codes)) {
            if ($r['error']['error_code'] == 6) {
                $this->cache->set($this->rateLimitCacheKey, true, 5);
            }
            returnServerError('API returned error: ' . $r['error']['error_msg'] . ' (' . $r['error']['error_code'] . ')');
        }
        return $r;
    }

}
